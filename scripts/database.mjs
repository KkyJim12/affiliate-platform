import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate, migrationStatus, readMigrations } from "../server/lib/migrations.ts";

let connection;
try {
  const command = process.argv[2];
  if (!["migrate", "status"].includes(command)) throw new Error("Usage: node scripts/database.mjs migrate|status");
  const path = resolve(process.env.LOOP_DATABASE_PATH || ".data/loop.sqlite");
  const migrations = readMigrations();
  console.log(`Database: ${path}`);
  if (command === "status" && !existsSync(path)) {
    for (const migration of migrations) console.log(`pending  ${migration.name}`);
  } else {
    if (command === "migrate") mkdirSync(dirname(path), { recursive: true });
    connection = new DatabaseSync(path, { readOnly: command === "status" });
    connection.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON");
    if (command === "migrate") {
      connection.exec("PRAGMA journal_mode = WAL");
      const applied = migrate(connection, migrations);
      console.log(applied.length ? `Applied ${applied.length} migration(s).` : "Database is up to date.");
    }
    for (const item of migrationStatus(connection, migrations)) console.log(`${item.status.padEnd(7)}  ${item.name}`);
  }
} catch (error) {
  console.error(error.message);
  if (error.cause) console.error(error.cause.message);
  process.exitCode = 1;
} finally { connection?.close(); }
