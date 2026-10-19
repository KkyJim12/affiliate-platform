import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createDatabase } from "../server/lib/postgres.ts";
import { migrate, migrationStatus, prepareMigrations, readMigrations, resetDatabase } from "../server/lib/migrations.ts";
import { importSqlite } from "../scripts/lib/import-sqlite.mjs";

const sources = readMigrations();
async function isolated(operation) {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url && new URL(url).pathname.endsWith("_test"), "Use the isolated PostgreSQL test runner.");
  const admin = createDatabase(url);
  const schema = `unxo_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(url);
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const database = createDatabase(scoped.toString());
  try {
    await admin.execute(`CREATE SCHEMA ${schema}`);
    return await operation(database, scoped.toString());
  } finally {
    await database.close();
    await admin.execute(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  }
}

test("PostgreSQL migrations are idempotent and enforce exact money, ownership and case-insensitive uniqueness", () => isolated(async db => {
  assert.deepEqual(await migrate(db.pool, sources), sources.map(item => item.name));
  assert.deepEqual(await migrate(db.pool, sources), []);
  assert.ok((await migrationStatus(db.pool, sources)).every(item => item.status === "applied"));
  await db.execute("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18')");
  await db.execute("INSERT INTO wallets (id, user_id, available) VALUES ('w', 'u', 999999999000000)");
  assert.equal((await db.one("SELECT available FROM wallets WHERE id = 'w'")).available, 999999999000000);
  assert.equal((await db.one("SELECT SUM(available) AS total FROM wallets")).total, 999999999000000);
  await assert.rejects(db.execute("UPDATE wallets SET available = -1 WHERE id = 'w'"), { code: "23514" });
  await assert.rejects(db.execute("UPDATE wallets SET available = 9007199254740992 WHERE id = 'w'"), { code: "23514" });
  await assert.rejects(db.execute("INSERT INTO wallets (id, user_id) VALUES ('orphan', 'missing')"), { code: "23503" });
  await assert.rejects(db.execute("INSERT INTO users VALUES ('duplicate', 'MEMBER', 'hash', 'UNASSIGNED-duplicate', NULL, '2026-10-18')"), { code: "23505" });
}));

test("existing referral codes migrate to UNXO while preserving suffixes and sponsor relationships", () => isolated(async db => {
  const previous = sources.filter(item => item.name < "0009_unxo_referral_codes.sql");
  await migrate(db.pool, previous);
  await db.execute(`INSERT INTO users VALUES
    ('sponsor', 'sponsor', 'hash', 'LOOP-1234ABCD', NULL, '2026-10-18'),
    ('member', 'member', 'hash', 'UNASSIGNED-member', 'sponsor', '2026-10-18'),
    ('current', 'current', 'hash', 'UNXO-ABCDEF12', NULL, '2026-10-18')`);
  assert.deepEqual(await migrate(db.pool, sources), sources.filter(source => source.name >= "0009_").map(source => source.name));
  assert.equal((await db.one("SELECT referral_code FROM users WHERE id = 'sponsor'")).referral_code, "UNXO-1234ABCD");
  assert.deepEqual(await db.one("SELECT referral_code, sponsor_id FROM users WHERE id = 'member'"), { referral_code: "UNASSIGNED-member", sponsor_id: "sponsor" });
  assert.equal((await db.one("SELECT referral_code FROM users WHERE id = 'current'")).referral_code, "UNXO-ABCDEF12");
  assert.deepEqual(await migrate(db.pool, sources), []);
}));

test("Amoy wallet schema enforces owner, address, key encryption and network constraints", () => isolated(async db => {
  await migrate(db.pool, sources);
  await db.execute("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18'), ('v', 'other', 'hash', 'UNASSIGNED-v', NULL, '2026-10-18')");
  const address = `0x${"ab".repeat(20)}`;
  const publicKey = `0x04${"1".repeat(128)}`;
  const encrypted = JSON.stringify({ version: 3, Crypto: { ciphertext: "2".repeat(64) } });
  const insert = (user, walletAddress, network, keystore = encrypted) => db.execute(
    "INSERT INTO evm_wallets VALUES ($1, $2, $3, $4, $5, '2026-10-18')", user, walletAddress, publicKey, keystore, network);
  await insert('u', address, 80002);
  assert.equal((await db.one("SELECT chain_id FROM evm_wallets WHERE user_id = 'u'")).chain_id, 80002);
  await assert.rejects(insert('missing', `0x${"3".repeat(40)}`, 80002), { code: "23503" });
  await assert.rejects(insert('u', `0x${"3".repeat(40)}`, 80002), { code: "23505" });
  await assert.rejects(insert('v', address.toUpperCase().replace('0X', '0x'), 80002), { code: "23505" });
  await assert.rejects(insert('v', `0x${"3".repeat(40)}`, 137), { code: "23514" });
  await assert.rejects(insert('v', 'LW-internal-wallet', 80002), { code: "23514" });
  await assert.rejects(insert('v', `0x${"3".repeat(40)}`, 80002, '{}'), { code: "23514" });
  await assert.rejects(db.transaction(async () => {
    await db.execute("INSERT INTO users VALUES ('rollback', 'rollback', 'hash', 'UNASSIGNED-rollback', NULL, '2026-10-18')");
    await insert('rollback', address, 80002);
  }), { code: "23505" });
  assert.equal(await db.one("SELECT id FROM users WHERE id = 'rollback'"), undefined);
}));

test("failed PostgreSQL migration batches roll back both schema and history", () => isolated(async db => {
  await migrate(db.pool, sources);
  const broken = prepareMigrations([{ name: "9999_failure.sql", sql: "CREATE TABLE should_rollback (id TEXT); INSERT INTO nonexistent VALUES (1);" }]);
  await assert.rejects(migrate(db.pool, [...sources, ...broken]), /9999_failure.sql/);
  assert.equal((await db.one("SELECT to_regclass('should_rollback') AS name")).name, null);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM schema_migrations")).count, sources.length);
  assert.deepEqual(await migrate(db.pool, sources), []);
}));

test("reset CLI requires exact confirmation and recreates only the selected schema with fresh migrations", () => isolated(async (db, url) => {
  await migrate(db.pool, sources);
  const defaults = await db.one("SELECT * FROM platform_settings WHERE id = 1");
  await db.execute("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18')");
  await db.execute("INSERT INTO wallets (id, user_id, available) VALUES ('w', 'u', 100)");
  await db.execute("UPDATE platform_settings SET registration_open = 0, support_email = 'old@example.com'");
  await db.execute("CREATE TABLE obsolete_reset_fixture (id TEXT)");
  const schema = (await db.one("SELECT current_schema() AS name")).name;
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  const run = (args, connectionString = url) => new Promise((done, reject) => {
    const child = spawn(process.execPath, ["scripts/reset-database.mjs", ...args], {
      env: { ...process.env, DATABASE_URL: connectionString }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.once("error", reject);
    child.once("exit", code => done({ code, output }));
  });
  const help = await run(["--help"], "not-a-database-url");
  assert.equal(help.code, 0); assert.match(help.output, /Usage:/);
  for (const args of [[], ["--confirm", `${name}_wrong`], ["--confirm"], ["--yes"]]) {
    const refused = await run(args);
    assert.equal(refused.code, 1);
    assert.equal((await db.one("SELECT available FROM wallets WHERE id = 'w'")).available, 100);
  }
  const reset = await run(["--confirm", name]);
  assert.equal(reset.code, 0, reset.output);
  assert.match(reset.output, /Reset complete/);
  assert.ok(reset.output.includes(`schema ${JSON.stringify(schema)}`));
  const password = decodeURIComponent(new URL(url).password);
  if (password) assert.ok(!reset.output.includes(password), "Reset output must not reveal the database password.");
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM users")).count, 0);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM wallets")).count, 0);
  assert.equal((await db.one("SELECT to_regclass('obsolete_reset_fixture') AS name")).name, null);
  assert.deepEqual(await db.one("SELECT * FROM platform_settings WHERE id = 1"), defaults);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM schema_migrations")).count, sources.length);
  assert.ok((await migrationStatus(db.pool, sources)).every(item => item.status === "applied"));
}));

test("a failed reset migration restores the original data, schema and migration history", () => isolated(async db => {
  await migrate(db.pool, sources);
  await db.execute("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18')");
  await db.execute("INSERT INTO wallets (id, user_id, available) VALUES ('w', 'u', 100)");
  await db.execute("CREATE TABLE preserved_reset_fixture (id TEXT)");
  await db.execute("INSERT INTO preserved_reset_fixture VALUES ('original')");
  const schema = (await db.one("SELECT current_schema() AS name")).name;
  const before = await db.all("SELECT * FROM schema_migrations ORDER BY name");
  const broken = prepareMigrations([{ name: "9999_reset_failure.sql", sql: "INSERT INTO nonexistent VALUES (1);" }]);
  await assert.rejects(resetDatabase(db.pool, [...sources, ...broken], schema), /9999_reset_failure.sql/);
  assert.equal((await db.one("SELECT available FROM wallets WHERE id = 'w'")).available, 100);
  assert.equal((await db.one("SELECT id FROM preserved_reset_fixture")).id, "original");
  assert.deepEqual(await db.all("SELECT * FROM schema_migrations ORDER BY name"), before);
}));

test("history validation rejects changed and missing files and normalizes Windows line endings", () => isolated(async db => {
  await migrate(db.pool, sources);
  const changed = prepareMigrations(sources.map(item => ({ name: item.name, sql: item.sql + (item === sources[0] ? "\n-- Changed" : "") })));
  await assert.rejects(migrate(db.pool, changed), /Applied migration was changed/);
  await assert.rejects(migrate(db.pool, sources.slice(1)), /history does not match/);
  assert.throws(() => prepareMigrations([{ name: "0001_a.sql", sql: "SELECT 1;" }, { name: "0001_b.sql", sql: "SELECT 2;" }]), /duplicate/);
  const windows = prepareMigrations(sources.map(item => ({ name: item.name, sql: item.sql.replace(/\n/g, "\r\n") })));
  assert.deepEqual(await migrate(db.pool, windows), []);
}));

test("concurrent CLI migrations use an advisory lock and status never creates application tables", () => isolated(async (db, url) => {
  const run = command => new Promise((done, reject) => {
    const child = spawn(process.execPath, ["scripts/database.mjs", command], { env: { ...process.env, DATABASE_URL: url }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? done(output) : reject(new Error(output)));
  });
  assert.match(await run("status"), /pending/);
  assert.equal((await db.one("SELECT to_regclass('schema_migrations') AS name")).name, null);
  await Promise.all([run("migrate"), run("migrate")]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM schema_migrations")).count, sources.length);
  assert.match(await run("status"), /applied/);
}));

test("async transactions keep one connection, roll back failures and serialize competing wallet debits", () => isolated(async db => {
  await migrate(db.pool, sources);
  await db.execute("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18')");
  await db.execute("INSERT INTO wallets (id, user_id, available) VALUES ('w', 'u', 100)");
  await assert.rejects(db.transaction(async () => { await db.execute("UPDATE wallets SET available = 0"); throw new Error("Abort"); }), /Abort/);
  assert.equal((await db.one("SELECT available FROM wallets")).available, 100);
  const debit = () => db.transaction(async () => {
    const wallet = await db.one("SELECT available FROM wallets WHERE id = 'w' FOR UPDATE");
    if (wallet.available < 60) throw new Error("Insufficient funds");
    await db.execute("UPDATE wallets SET available = available - 60 WHERE id = 'w'");
  });
  const results = await Promise.allSettled([debit(), debit()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await db.one("SELECT available FROM wallets")).available, 40);
}));

test("SQLite import preserves accounts, sponsors, balances, sessions, ledger, settings and reviews without modifying source", () => isolated(async db => {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = mkdtempSync(join(tmpdir(), "unxo-import-"));
  const path = join(directory, "legacy.sqlite");
  const source = new DatabaseSync(path);
  try {
    source.exec(`
      CREATE TABLE users (id, username, password_hash, referral_code, sponsor_id, created_at);
      CREATE TABLE wallets (id, user_id, available, reserved);
      CREATE TABLE sessions (token_hash, user_id, expires_at);
      CREATE TABLE wallet_transactions (id, wallet_id, type, amount, status, description, request_key, created_at);
      CREATE TABLE user_access (user_id, role, status);
      CREATE TABLE payment_reviews (transaction_id, decision, reference, note, admin_id, created_at);
      CREATE TABLE referral_activations (user_id, transaction_id, created_at);
      CREATE TABLE platform_settings (id, registration_open, funding_open, support_email);
      INSERT INTO users VALUES ('member', 'member', 'original-member-hash', 'UNASSIGNED-member', 'admin', '2026-10-18');
      INSERT INTO users VALUES ('admin', 'admin', 'original-admin-hash', 'LOOP-1234ABCD', NULL, '2026-10-18');
      INSERT INTO wallets VALUES ('w', 'member', 25000000, 3000000);
      INSERT INTO sessions VALUES ('original-token-hash', 'member', 9999999999999);
      INSERT INTO wallet_transactions VALUES ('t', 'w', 'referral_purchase', 10000000, 'completed', 'Referral activation', 'original-request-key', '2026-10-18');
      INSERT INTO user_access VALUES ('admin', 'admin', 'active');
      INSERT INTO referral_activations (user_id, transaction_id, created_at) VALUES ('admin', 't', '2026-10-18');
      INSERT INTO payment_reviews VALUES ('t', 'approved', 'Original-Reference', 'Preserved note', 'admin', '2026-10-18');
      INSERT INTO platform_settings VALUES (1, 0, 0, 'existing@example.com');
    `);
    source.close();
    const before = readFileSync(path);
    await migrate(db.pool, sources);
    const counts = await importSqlite(path, db);
    assert.equal(counts.users, 2);
    assert.equal((await db.one("SELECT referral_code FROM users WHERE id = 'admin'")).referral_code, "UNXO-1234ABCD");
    assert.deepEqual(await db.one("SELECT sponsor_id, password_hash FROM users WHERE id = 'member'"), { sponsor_id: "admin", password_hash: "original-member-hash" });
    assert.deepEqual(await db.one("SELECT available, reserved FROM wallets WHERE id = 'w'"), { available: 25000000, reserved: 3000000 });
    assert.equal((await db.one("SELECT token_hash FROM sessions")).token_hash, "original-token-hash");
    assert.equal((await db.one("SELECT COUNT(*) AS total FROM schema_migrations")).total, sources.length);
    assert.equal((await db.one("SELECT support_email FROM platform_settings")).support_email, "existing@example.com");
    assert.equal((await db.one("SELECT note FROM payment_reviews")).note, "Preserved note");
    await assert.rejects(importSqlite(path, db), /empty PostgreSQL destination/);
    assert.equal((await db.one("SELECT COUNT(*) AS total FROM users")).total, 2);
    assert.deepEqual(readFileSync(path), before);
  } finally {
    try { source.close(); } catch {}
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("unxo-import-"));
    rmSync(directory, { recursive: true, force: true });
  }
}));

test("invalid SQLite relationships roll back the entire PostgreSQL import", () => isolated(async db => {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = mkdtempSync(join(tmpdir(), "unxo-import-"));
  const path = join(directory, "invalid.sqlite");
  const source = new DatabaseSync(path);
  try {
    source.exec(`
      CREATE TABLE users (id, username, password_hash, referral_code, sponsor_id, created_at);
      CREATE TABLE wallets (id, user_id, available, reserved);
      CREATE TABLE sessions (token_hash, user_id, expires_at);
      CREATE TABLE wallet_transactions (id, wallet_id, type, amount, status, description, request_key, created_at);
      INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', 'missing-sponsor', '2026-10-18');
      INSERT INTO wallets VALUES ('w', 'u', 10000000, 0);
    `);
    source.close();
    await migrate(db.pool, sources);
    await assert.rejects(importSqlite(path, db), { code: "23503" });
    assert.equal((await db.one("SELECT COUNT(*) AS total FROM users")).total, 0);
    assert.equal((await db.one("SELECT COUNT(*) AS total FROM wallets")).total, 0);
    assert.equal((await db.one("SELECT COUNT(*) AS total FROM schema_migrations")).total, sources.length);
  } finally {
    try { source.close(); } catch {}
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("unxo-import-"));
    rmSync(directory, { recursive: true, force: true });
  }
}));
