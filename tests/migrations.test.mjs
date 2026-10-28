import { unlockMatrixLevel, referralRecipients } from "../server/utils/matrix.ts";
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
  const unxoSources = sources.filter(item => item.name < "0010_");
  const previous = sources.filter(item => item.name < "0009_unxo_referral_codes.sql");
  await migrate(db.pool, previous);
  await db.execute(`INSERT INTO users VALUES
    ('sponsor', 'sponsor', 'hash', 'LOOP-1234ABCD', NULL, '2026-10-18'),
    ('member', 'member', 'hash', 'UNASSIGNED-member', 'sponsor', '2026-10-18'),
    ('current', 'current', 'hash', 'UNXO-ABCDEF12', NULL, '2026-10-18')`);
  assert.deepEqual(await migrate(db.pool, unxoSources), unxoSources.filter(source => source.name >= "0009_").map(source => source.name));
  assert.equal((await db.one("SELECT referral_code FROM users WHERE id = 'sponsor'")).referral_code, "UNXO-1234ABCD");
  assert.deepEqual(await db.one("SELECT referral_code, sponsor_id FROM users WHERE id = 'member'"), { referral_code: "UNASSIGNED-member", sponsor_id: "sponsor" });
  assert.equal((await db.one("SELECT referral_code FROM users WHERE id = 'current'")).referral_code, "UNXO-ABCDEF12");
  assert.deepEqual(await migrate(db.pool, unxoSources), []);
}));

test("numeric referral migration preserves accounts and legacy invites, and allocates consecutive IDs transactionally", () => isolated(async db => {
  await migrate(db.pool, sources.filter(item => item.name < "0012_"));
  await db.execute(`INSERT INTO users VALUES
    ('a', 'first', 'hash', 'UNXO-1234ABCD', NULL, '2026-10-17'),
    ('b', 'second', 'hash', 'UNASSIGNED-b', 'a', '2026-10-18')`);
  await migrate(db.pool, sources);
  assert.deepEqual(await db.all("SELECT id, referral_code, sponsor_id FROM users ORDER BY referral_code::BIGINT"), [
    { id: 'a', referral_code: '1', sponsor_id: null }, { id: 'b', referral_code: '2', sponsor_id: 'a' },
  ]);
  assert.equal((await db.one("SELECT user_id FROM referral_code_aliases WHERE code = 'UNXO-1234ABCD'")).user_id, 'a');
  await assert.rejects(db.transaction(async () => {
    await db.execute("INSERT INTO users VALUES ('failed', 'failed', 'hash', 'UNASSIGNED-failed', NULL, '2026-10-19')");
    throw new Error('rollback registration');
  }), /rollback registration/);
  await Promise.all(Array.from({ length: 12 }, (_, i) => db.execute(
    "INSERT INTO users VALUES ($1,$1,'hash',$1,NULL,'2026-10-19')", `concurrent_${i}`)));
  assert.deepEqual((await db.all("SELECT referral_code::INTEGER AS id FROM users ORDER BY id")).map(row => row.id), Array.from({ length: 14 }, (_, i) => i + 1));
  assert.equal((await db.one("SELECT last_id FROM referral_id_counter")).last_id, 14);
  assert.equal(await db.one("SELECT id FROM users WHERE id = 'failed'"), undefined);
}));

test("binary placements fill breadth first with two slots, survive rollback and attach existing branches without cycles", () => isolated(async db => {
  await migrate(db.pool, sources);
  const insert = (id, sponsor = null) => db.execute("INSERT INTO users VALUES ($1,$1,'hash',$1,$2,'2026-10-19')", id, sponsor);
  await insert('root');
  await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(id => insert(id, 'root')));
  const placements = await db.all(`SELECT p.parent_id, p.slot, u.referral_code::INTEGER AS member FROM referral_placements p
    JOIN users u ON u.id = p.user_id ORDER BY member`);
  const byNumber = await db.all("SELECT id FROM users ORDER BY referral_code::BIGINT");
  assert.deepEqual(placements.map(row => [row.parent_id, row.slot]), [
    ['root', 0], ['root', 1], [byNumber[1].id, 0], [byNumber[1].id, 1], [byNumber[2].id, 0], [byNumber[2].id, 1],
  ]);
  await insert('late_root');
  await db.execute("UPDATE users SET sponsor_id = 'late_root' WHERE id = 'root'");
  assert.deepEqual(await db.one("SELECT parent_id, slot FROM referral_placements WHERE user_id = 'root'"), { parent_id: 'late_root', slot: 0 });
  await assert.rejects(db.execute("UPDATE users SET sponsor_id = 'a' WHERE id = 'late_root'"), { code: '23514' });
  assert.equal((await db.one("SELECT sponsor_id FROM users WHERE id = 'late_root'")).sponsor_id, null);
  await assert.rejects(db.transaction(async () => { await insert('rollback', 'root'); throw new Error('rollback'); }), /rollback/);
  assert.equal(await db.one("SELECT user_id FROM referral_placements WHERE user_id = 'rollback'"), undefined);
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
    assert.equal((await db.one("SELECT referral_code FROM users WHERE id = 'admin'")).referral_code, "2");
    assert.equal((await db.one("SELECT user_id FROM referral_code_aliases WHERE code = 'UNXO-1234ABCD'")).user_id, "admin");
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

test("matrix slots limit each cycle to three descendant rows, recycle once and queue wallet-funded upgrades", () => isolated(async db => {
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES ('root','matrix_root','hash','UNASSIGNED-root',NULL,'2026-10-28')");
  await db.execute("INSERT INTO wallets(id,user_id,available) VALUES('w-root','root',100000000)");
  for(let i=1;i<=16;i++) {
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'root',$2)",`child${i}`,`2026-10-28T00:00:${String(i).padStart(2,'0')}Z`);
    await db.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",`w-child${i}`,`child${i}`);
  }
  const matrix=await db.all(`WITH RECURSIVE positions AS (
    SELECT id,0 AS depth FROM matrix_slots WHERE user_id='root' AND level=1 AND cycle=0
    UNION ALL SELECT s.id,p.depth+1 FROM positions p JOIN matrix_slots s ON s.parent_id=p.id
  ) SELECT depth,COUNT(*) AS count FROM positions GROUP BY depth ORDER BY depth`);
  assert.deepEqual(matrix,[{depth:0,count:1},{depth:1,count:2},{depth:2,count:4},{depth:3,count:8}]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE user_id='root' AND level=1")).count,2);
  assert.equal((await db.one("SELECT parent_id FROM referral_placements WHERE user_id='child15'")).parent_id,'child7');
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE parent_id IS NOT NULL GROUP BY parent_id HAVING COUNT(*)>2 LIMIT 1")),undefined);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_auto_upgrades")).count,0);
  await db.transaction(()=>unlockMatrixLevel('root',1,db));
  for(let i=1;i<=13;i++) await db.transaction(()=>unlockMatrixLevel(`child${i}`,1,db));
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_auto_upgrades WHERE user_id='root'")).count,0);
  await db.transaction(()=>unlockMatrixLevel('child14',1,db));
  await db.transaction(()=>unlockMatrixLevel('child14',1,db));
  assert.deepEqual(await db.all("SELECT user_id,level,status FROM matrix_auto_upgrades WHERE user_id='root'"),[{user_id:'root',level:2,status:'queued'}]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE user_id='root' AND level=1")).count,2);
  assert.ok((await db.one("SELECT completed_at FROM matrix_slots WHERE user_id='root' AND level=1 AND cycle=0")).completed_at);
  assert.equal((await db.one("SELECT unlocked FROM matrix_slots WHERE user_id='root' AND level=2 AND cycle=0")).unlocked,false);
  const recipients=await referralRecipients('child3',1,'ledger',db);
  assert.equal(recipients.length,18);
  assert.equal(recipients[0].userId,'child1'); assert.equal(recipients[1].userId,'root');
  assert.equal(recipients[3].userId,'child1'); assert.equal(recipients[4].userId,'root');
  const locked=await referralRecipients('child3',2,'ledger',db);
  assert.ok(locked.every(item=>item.userId===null));
  await db.transaction(()=>unlockMatrixLevel('root',2,db));
  const qualified=await referralRecipients('child3',2,'ledger',db);
  assert.equal(qualified[0].reason,'ineligible_upline'); assert.equal(qualified[1].userId,'root');
  assert.equal(qualified[3].reason,'ineligible_upline'); assert.equal(qualified[4].userId,'root');
  await db.execute("INSERT INTO user_access VALUES('root','member','suspended')");
  assert.equal((await referralRecipients('child3',2,'ledger',db))[1].reason,'ineligible_upline');
}));

test("matrix placement attaches existing root branches when a sponsor is linked later", () => isolated(async db => {
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES('a','late_a','hash','a',NULL,'2026-10-28'),('b','late_b','hash','b',NULL,'2026-10-28')");
  await db.execute("INSERT INTO users VALUES('c','late_c','hash','c','b','2026-10-28')");
  await db.execute("UPDATE users SET sponsor_id='a' WHERE id='b'");
  const placement=await db.one("SELECT p.user_id FROM matrix_slots s JOIN matrix_slots p ON p.id=s.parent_id WHERE s.user_id='b' AND s.level=1 AND s.cycle=0");
  assert.equal(placement.user_id,'a');
  await assert.rejects(db.execute("UPDATE users SET sponsor_id='c' WHERE id='a'"),{code:'23514'});
}));

test("successive matrix rebirths reserve the next unowned levels, preserve old slots and stop upgrading at 15", () => isolated(async db => {
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES('rebirth','rebirth_owner','hash','rebirth',NULL,'2026-10-28')");
  await db.transaction(()=>unlockMatrixLevel('rebirth',1,db));
  for (let cycle=0;cycle<3;cycle++) {
    for (let child=0;child<14;child++) {
      const id = `rebirth-${cycle}-${child}`;
      await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'rebirth','2026-10-28')",id);
      await db.transaction(()=>unlockMatrixLevel(id,1,db));
    }
    await db.transaction(()=>unlockMatrixLevel('rebirth',1,db));
  }
  assert.deepEqual((await db.all("SELECT level FROM referral_auto_upgrades WHERE user_id='rebirth' ORDER BY level")).map(row=>row.level),[2,3,4]);
  assert.deepEqual((await db.all("SELECT cycle FROM matrix_slots WHERE user_id='rebirth' AND level=1 ORDER BY cycle")).map(row=>row.cycle),[0,1,2,3]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE user_id='rebirth' AND level=1 AND completed_at IS NOT NULL")).count,3);
  await db.transaction(()=>unlockMatrixLevel('rebirth',15,db));
  for (let child=0;child<14;child++) {
    const id = `rebirth-final-${child}`;
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'rebirth','2026-10-28')",id);
    await db.transaction(()=>unlockMatrixLevel(id,1,db));
  }
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades WHERE user_id='rebirth'")).count,3);
  assert.equal((await db.one("SELECT MAX(cycle) AS cycle FROM matrix_slots WHERE user_id='rebirth' AND level=1")).cycle,4);
}));

test("paid rebirth migration hides unpaid overflow and preserves completed cycles and placement", () => isolated(async db => {
  await migrate(db.pool,sources.filter(item=>item.name < '0015_'));
  await db.execute("INSERT INTO users VALUES('legacy-gate','legacy_gate','hash','legacy-gate',NULL,'2026-10-29')");
  for (let i=0;i<15;i++) await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'legacy-gate','2026-10-29')",`legacy-gate-${i}`);
  await db.execute("UPDATE matrix_slots SET unlocked=TRUE WHERE level=2");
  await db.execute("UPDATE matrix_slots SET completed_at='2026-10-29' WHERE user_id='legacy-gate' AND level=2 AND cycle=0");
  const placement = await db.all("SELECT id,parent_id,branch,unlocked,completed_at FROM matrix_slots ORDER BY id");
  await migrate(db.pool,sources);
  assert.deepEqual(await db.all("SELECT id,parent_id,branch,unlocked,completed_at FROM matrix_slots ORDER BY id"),placement);
  assert.deepEqual(await db.all("SELECT level,opened FROM matrix_slots WHERE user_id='legacy-gate' AND level IN (1,2) AND cycle=1 ORDER BY level"),[
    {level:1,opened:false},{level:2,opened:true},
  ]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades")).count,0);
}));

test("rebirth waits for the owner and every same-level branch, including prepaid overflow cycles", () => isolated(async db => {
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES('gate','gate','hash','gate',NULL,'2026-10-29')");
  for (let i=0;i<42;i++) {
    const id = `gate-${i}`;
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'gate','2026-10-29')",id);
    // Leave one unpaid position in each descendant row of the initial cycle.
    if (![0,2,6].includes(i)) await db.transaction(()=>unlockMatrixLevel(id,2,db));
  }
  const opened = async () => (await db.all("SELECT cycle FROM matrix_slots WHERE user_id='gate' AND level=2 AND opened ORDER BY cycle")).map(row=>row.cycle);
  assert.deepEqual(await opened(),[0]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades WHERE user_id='gate'")).count,0);
  // Paying the owner at a different level cannot open the level-2 rebirth.
  await db.transaction(()=>unlockMatrixLevel('gate',1,db));
  await db.transaction(()=>unlockMatrixLevel('gate-0',2,db));
  await db.transaction(()=>unlockMatrixLevel('gate-2',2,db));
  assert.deepEqual(await opened(),[0]);
  await db.transaction(()=>unlockMatrixLevel('gate-6',2,db));
  assert.deepEqual(await opened(),[0]); // All descendants paid, owner still unpaid.
  await db.transaction(()=>unlockMatrixLevel('gate',2,db));
  assert.deepEqual(await opened(),[0,1,2,3]);
  assert.deepEqual((await db.all("SELECT cycle FROM matrix_slots WHERE user_id='gate' AND level=2 AND completed_at IS NOT NULL ORDER BY cycle")).map(row=>row.cycle),[0,1,2]);
  const jobs = await db.all("SELECT cycle_id,level FROM referral_auto_upgrades WHERE user_id='gate' ORDER BY level");
  await db.transaction(()=>unlockMatrixLevel('gate',2,db));
  assert.deepEqual(await db.all("SELECT cycle_id,level FROM referral_auto_upgrades WHERE user_id='gate' ORDER BY level"),jobs);
}));

test("historical full unilevel trees do not charge; a new fifteen-row completion queues once after all 65,534 descendants pay", { timeout:180000 }, () => isolated(async db => {
  // Build a large legacy tree directly in this disposable schema. Suppress only
  // registration placement while importing its already determined binary edges.
  await migrate(db.pool,sources.filter(item=>item.name < '0014_'));
  await db.execute("ALTER TABLE users DISABLE TRIGGER users_place_binary_referral");
  await db.execute("ALTER TABLE users DISABLE TRIGGER users_place_matrix_slots");
  await db.execute(`INSERT INTO users(id,username,password_hash,referral_code,sponsor_id,created_at)
    SELECT 'uni-' || n,'uni_' || n,'hash','uni-' || n,NULL,'2026-10-28' FROM generate_series(1,65535) n`);
  await db.execute(`INSERT INTO referral_placements(user_id,parent_id,slot)
    SELECT 'uni-' || n,'uni-' || (n/2),(n%2)::SMALLINT FROM generate_series(2,65535) n`);
  await db.execute(`INSERT INTO matrix_slots(id,user_id,level,cycle,unlocked,created_at)
    SELECT 'matrix:' || tier || ':uni-' || n || ':0','uni-' || n,tier,0,tier=1 OR n<>65535,'2026-10-28'
    FROM generate_series(1,65535) n CROSS JOIN generate_series(1,2) tier`);
  await db.execute("ALTER TABLE users ENABLE TRIGGER users_place_binary_referral");
  await db.execute("ALTER TABLE users ENABLE TRIGGER users_place_matrix_slots");
  await migrate(db.pool,sources);
  assert.equal((await db.one("SELECT complete_depth FROM unilevel_progress WHERE user_id='uni-1' AND level=1")).complete_depth,15);
  assert.ok((await db.one("SELECT completed_at FROM unilevel_progress WHERE user_id='uni-1' AND level=1")).completed_at);
  assert.deepEqual(await db.one("SELECT complete_depth,completed_at FROM unilevel_progress WHERE user_id='uni-1' AND level=2"),{complete_depth:14,completed_at:null});
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades")).count,0);
  await db.transaction(()=>unlockMatrixLevel('uni-65535',2,db));
  assert.equal((await db.one("SELECT complete_depth FROM unilevel_progress WHERE user_id='uni-1' AND level=2")).complete_depth,15);
  assert.ok((await db.one("SELECT completed_at FROM unilevel_progress WHERE user_id='uni-1' AND level=2")).completed_at);
  assert.deepEqual(await db.all("SELECT user_id,level,source,source_level FROM referral_auto_upgrades"),[{user_id:'uni-1',level:3,source:'unilevel',source_level:2}]);
  await db.transaction(()=>unlockMatrixLevel('uni-65535',2,db));
  await db.transaction(()=>unlockMatrixLevel('uni-1',2,db));
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades")).count,1);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_placements")).count,65534);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE user_id='uni-1' AND level=1")).count,1);
}));

test("the shared upgrade queue preserves existing matrix jobs and their error history", () => isolated(async db => {
  await migrate(db.pool,sources.filter(item=>item.name < '0014_'));
  await db.execute("INSERT INTO users VALUES('preserved','preserved_member','hash','preserved',NULL,'2026-10-28')");
  await db.execute(`INSERT INTO matrix_auto_upgrades(cycle_id,user_id,level,last_error,created_at)
    VALUES('matrix:1:preserved:0','preserved',2,'Waiting for token approval.','2026-10-28')`);
  await migrate(db.pool,sources);
  assert.deepEqual(await db.one("SELECT cycle_id,user_id,level,source,source_level,slot_id,status,last_error FROM referral_auto_upgrades"),{
    cycle_id:'matrix:1:preserved:0',user_id:'preserved',level:2,source:'matrix',source_level:1,slot_id:'matrix:1:preserved:0',status:'queued',last_error:'Waiting for token approval.'
  });
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_auto_upgrades")).count,1);
}));

test("late attachment of a paid unilevel branch refreshes its new ancestors", () => isolated(async db => {
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES('up','uni_up','hash','up',NULL,'2026-10-28'),('left','uni_left','hash','left','up','2026-10-28'),('right','uni_right','hash','right',NULL,'2026-10-28')");
  for (const id of ['up','left','right']) await db.transaction(()=>unlockMatrixLevel(id,1,db));
  assert.equal((await db.one("SELECT complete_depth FROM unilevel_progress WHERE user_id='up'")).complete_depth,0);
  await db.execute("UPDATE users SET sponsor_id='up' WHERE id='right'");
  assert.equal((await db.one("SELECT complete_depth FROM unilevel_progress WHERE user_id='up'")).complete_depth,1);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades")).count,0);
}));
