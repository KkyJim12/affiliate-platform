import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { migrate, migrationStatus, prepareMigrations, readMigrations } from "../server/lib/migrations.ts";

const sources = readMigrations();
const memory = () => { const connection = new DatabaseSync(":memory:"); connection.exec("PRAGMA foreign_keys = ON"); return connection; };

test("fresh database applies every migration once and enforces ledger constraints", () => {
  const connection = memory();
  try {
    assert.deepEqual(migrate(connection, sources), sources.map(item => item.name));
    assert.deepEqual(migrate(connection, sources), []);
    assert.equal(migrationStatus(connection, sources).every(item => item.status === "applied"), true);
    connection.prepare("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18')").run();
    connection.prepare("INSERT INTO wallets (id, user_id, available) VALUES ('w', 'u', 10000000)").run();
    assert.throws(() => connection.prepare("UPDATE wallets SET available = -1 WHERE id = 'w'").run(), /CHECK constraint/);
    assert.throws(() => connection.prepare("INSERT INTO wallets (id, user_id) VALUES ('orphan', 'missing')").run(), /FOREIGN KEY/);
    const indexes = connection.prepare("PRAGMA index_list(wallet_transactions)").all().map(row => row.name);
    assert.ok(indexes.includes("wallet_transactions_wallet_created"));
  } finally { connection.close(); }
});

test("legacy schema adoption preserves accounts, sessions, balances, reviews, access, settings and activations", () => {
  const connection = memory();
  try {
    // Previous releases executed these schemas without recording migration history.
    for (const source of sources.slice(0, 3)) connection.exec(source.sql);
    connection.exec(`
      INSERT INTO users VALUES ('u', 'legacy', 'password-hash', 'LOOP-1234ABCD', NULL, '2026-10-18');
      INSERT INTO sessions VALUES ('session-hash', 'u', 9999999999999);
      INSERT INTO wallets VALUES ('w', 'u', 25000000, 3000000);
      INSERT INTO wallet_transactions VALUES ('t', 'w', 'referral_purchase', 10000000, 'completed', 'Referral activation', 'request-key', '2026-10-18');
      INSERT INTO referral_activations VALUES ('u', 't', '2026-10-18');
      INSERT INTO user_access VALUES ('u', 'admin', 'active');
      INSERT INTO payment_reviews VALUES ('t', 'approved', 'LEGACY-REFERENCE', 'Preserved note', 'u', '2026-10-18');
      INSERT INTO admin_audit VALUES ('a', 'u', 'admin_created', 'legacy', '2026-10-18');
      UPDATE platform_settings SET registration_open = 0, funding_open = 0, support_email = 'existing@example.com';
    `);
    const tables = ["users", "sessions", "wallets", "wallet_transactions", "referral_activations", "user_access", "payment_reviews", "admin_audit", "platform_settings"];
    const before = tables.map(table => connection.prepare(`SELECT * FROM ${table}`).all());
    migrate(connection, sources);
    assert.deepEqual(tables.map(table => connection.prepare(`SELECT * FROM ${table}`).all()), before);
  } finally { connection.close(); }
});

test("failed migrations roll back schema changes and history together", () => {
  const connection = memory();
  try {
    migrate(connection, sources);
    const broken = prepareMigrations([{ name: "0005_failure.sql", sql: "CREATE TABLE should_rollback (id TEXT); INSERT INTO nonexistent VALUES (1);" }]);
    assert.throws(() => migrate(connection, [...sources, ...broken]), /0005_failure.sql/);
    assert.equal(connection.prepare("SELECT name FROM sqlite_master WHERE name = 'should_rollback'").get(), undefined);
    assert.equal(connection.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, sources.length);
    assert.deepEqual(migrate(connection, sources), []);
  } finally { connection.close(); }
});

test("history checks reject modified, removed and out-of-order migrations", () => {
  const connection = memory();
  try {
    migrate(connection, sources);
    const changed = prepareMigrations(sources.map(item => ({ name: item.name, sql: item.sql + (item === sources[0] ? "\n-- Changed" : "") })));
    assert.throws(() => migrate(connection, changed), /Applied migration was changed/);
    assert.throws(() => migrate(connection, sources.slice(1)), /history does not match/);
    assert.throws(() => prepareMigrations([{ name: "0001_a.sql", sql: "SELECT 1;" }, { name: "0001_b.sql", sql: "SELECT 2;" }]), /duplicate/);
    const windows = prepareMigrations(sources.map(item => ({ name: item.name, sql: item.sql.replace(/\n/g, "\r\n") })));
    assert.deepEqual(migrate(connection, windows), []);
  } finally { connection.close(); }
});

test("concurrent migration processes serialize safely and status does not create a database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "unxo-migrations-"));
  const path = join(directory, "database.sqlite");
  const run = command => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/database.mjs", command], { env: { ...process.env, LOOP_DATABASE_PATH: path }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve(output) : reject(new Error(output)));
  });
  try {
    await run("status");
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(path), false);
    await Promise.all([run("migrate"), run("migrate")]);
    const connection = new DatabaseSync(path);
    try { assert.equal(connection.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, sources.length); }
    finally { connection.close(); }
    assert.match(await run("status"), /applied/);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("unxo-migrations-"));
    rmSync(directory, { recursive: true, force: true });
  }
});
