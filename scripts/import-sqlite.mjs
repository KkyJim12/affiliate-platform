import { resolve } from "node:path";
import { createDatabase } from "../server/lib/postgres.ts";
import { migrate, readMigrations } from "../server/lib/migrations.ts";
import { importSqlite } from "./lib/import-sqlite.mjs";

let database;
try {
  if (process.argv[2] !== "--source" || !process.argv[3] || process.argv.length !== 4) throw new Error("Usage: npm run db:import:sqlite -- --source .data/loop.sqlite");
  database = createDatabase();
  await migrate(database.pool, readMigrations());
  const counts = await importSqlite(resolve(process.argv[3]), database);
  console.log("SQLite data imported into PostgreSQL. The source file was not modified.");
  for (const [table, count] of Object.entries(counts)) console.log(`${table}: ${count}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await database?.close(); }
