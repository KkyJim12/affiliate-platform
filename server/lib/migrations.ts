import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

export interface Migration { name: string; sql: string; checksum: string }
interface AppliedMigration { name: string; checksum: string; applied_at: string }

export function prepareMigrations(sources: { name: string; sql: string }[]): Migration[] {
  if (!sources.length) throw new Error("No database migrations were found.");
  const versions = new Set<string>();
  return [...sources].sort((a, b) => a.name.localeCompare(b.name)).map(source => {
    const version = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(source.name)?.[1];
    if (!version || versions.has(version)) throw new Error(`Invalid or duplicate migration version: ${source.name}`);
    versions.add(version);
    const sql = source.sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    if (!sql.trim()) throw new Error(`Migration is empty: ${source.name}`);
    return { name: source.name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
}

export function readMigrations(directory = fileURLToPath(new URL("../../database/migrations/", import.meta.url))) {
  return prepareMigrations(readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".sql"))
    .map(entry => ({ name: entry.name, sql: readFileSync(join(directory, entry.name), "utf8") })));
}

export async function migrationStatus(connection: Pick<PoolClient, "query">, migrations: readonly Migration[]) {
  const exists = (await connection.query("SELECT to_regclass('schema_migrations') AS name")).rows[0].name;
  const history = exists ? (await connection.query("SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name")).rows as AppliedMigration[] : [];
  for (const [index, applied] of history.entries()) {
    const expected = migrations[index];
    if (!expected || applied.name !== expected.name) throw new Error(`Migration history does not match this build at ${applied.name}. Restore the original migration files.`);
    if (applied.checksum !== expected.checksum) throw new Error(`Applied migration was changed: ${applied.name}. Add a new migration instead of editing an applied file.`);
  }
  return migrations.map((migration, index) => ({ name: migration.name, status: index < history.length ? "applied" as const : "pending" as const, appliedAt: history[index]?.applied_at || null }));
}

export async function migrate(pool: Pool, migrations: readonly Migration[]) {
  return runMigrations(pool, migrations);
}

export async function resetDatabase(pool: Pool, migrations: readonly Migration[], schema = "public") {
  return runMigrations(pool, migrations, schema);
}

async function runMigrations(pool: Pool, migrations: readonly Migration[], resetSchema?: string) {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(782438, 1)");
    if (resetSchema !== undefined) {
      const identifier = `"${resetSchema.replaceAll('"', '""')}"`;
      await connection.query("SET LOCAL lock_timeout = '5s'");
      await connection.query(`DROP SCHEMA IF EXISTS ${identifier} CASCADE`);
      await connection.query(`CREATE SCHEMA ${identifier}`);
      await connection.query(`SET LOCAL search_path TO ${identifier}`);
    }
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
    const pending = (await migrationStatus(connection, migrations)).filter(item => item.status === "pending");
    for (const item of pending) {
      const migration = migrations.find(candidate => candidate.name === item.name)!;
      try { await connection.query(migration.sql); }
      catch (cause) { throw new Error(`Database migration failed: ${migration.name}`, { cause }); }
      await connection.query("INSERT INTO schema_migrations VALUES ($1, $2, $3)", [migration.name, migration.checksum, new Date().toISOString()]);
    }
    await connection.query("COMMIT");
    return pending.map(item => item.name);
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally { connection.release(); }
}
