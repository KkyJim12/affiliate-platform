import { createDatabase } from "../server/lib/postgres.ts";
import { migrate, migrationStatus, readMigrations } from "../server/lib/migrations.ts";

let database;
try {
  const command = process.argv[2];
  if (!["migrate", "status"].includes(command)) throw new Error("Usage: node scripts/database.mjs migrate|status");
  database = createDatabase();
  const migrations = readMigrations();
  if (command === "migrate") {
    const applied = await migrate(database.pool, migrations);
    console.log(applied.length ? `Applied ${applied.length} PostgreSQL migration(s).` : "Database is up to date.");
  }
  for (const item of await migrationStatus(database.pool, migrations)) console.log(`${item.status.padEnd(7)}  ${item.name}`);
} catch (error) {
  console.error(error.message);
  if (error.cause) console.error(error.cause.message);
  process.exitCode = 1;
} finally { await database?.close(); }
