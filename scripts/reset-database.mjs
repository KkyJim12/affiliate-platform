import { createInterface } from "node:readline/promises";
import { createDatabase } from "../server/lib/postgres.ts";
import { readMigrations, resetDatabase } from "../server/lib/migrations.ts";

const usage = "Usage: npm run db:reset [-- --confirm <database-name>]";
let database;
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    console.log("Deletes the selected schema and recreates it using all migrations. Stop the app and back up first.");
  } else {
    if (args.length && (args.length !== 2 || args[0] !== "--confirm" || !args[1])) throw new Error(usage);
    const confirmation = args[1];
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || !/^postgres(?:ql)?:\/\//.test(connectionString)) throw new Error("Set DATABASE_URL to a PostgreSQL connection URL. See .env.example.");
    const url = new URL(connectionString);
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!name) throw new Error("DATABASE_URL must include the database name to reset.");
    if (confirmation !== undefined && confirmation !== name) throw new Error("Reset refused: --confirm must match the database name in DATABASE_URL.");
    if (confirmation === undefined && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error(`${usage}\nNon-interactive resets require --confirm followed by the exact database name.`);

    const migrations = readMigrations();
    database = createDatabase(connectionString);
    const target = await database.one("SELECT current_database() AS name, current_schema() AS schema");
    if (target.name !== name) throw new Error("Reset refused: the connected database does not match DATABASE_URL's database name.");
    if (!target.schema) throw new Error("Reset refused: the connection has no selected schema. Check its search_path.");
    console.log(`Target: ${url.hostname}:${url.port || 5432}/${name} (schema ${JSON.stringify(target.schema)})`);
    console.log("This deletes all data in that schema, including accounts, transactions and encrypted wallet keys.");
    console.log("Stop the app and back up first. Blockchain balances and contracts persist separately.");

    if (confirmation === undefined) {
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      const controller = new AbortController();
      prompt.on("SIGINT", () => controller.abort());
      prompt.on("close", () => controller.abort());
      try {
        const answer = await prompt.question(`Type RESET ${name} to continue: `, { signal: controller.signal });
        if (answer !== `RESET ${name}`) throw new Error("Reset cancelled. Database was not changed.");
      } catch (error) {
        if (error.name === "AbortError") throw new Error("Reset cancelled. Database was not changed.");
        throw error;
      } finally { prompt.close(); }
    }

    const applied = await resetDatabase(database.pool, migrations, target.schema);
    console.log(`Reset complete. Applied ${applied.length} migration(s).`);
    console.log("Create a new administrator with npm run admin:create, then restart the app.");
  }
} catch (error) {
  console.error(error.message);
  if (error.cause) console.error(error.cause.message);
  process.exitCode = 1;
} finally { await database?.close(); }
