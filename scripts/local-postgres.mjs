import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

// A foreground development service. Production uses an installed/hosted PostgreSQL server.
let server;
try {
  const url = new URL(process.env.DATABASE_URL || "");
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname) || !/^[a-z_][a-z0-9_]{0,62}$/.test(name) || !url.username || !url.password) {
    throw new Error("db:start requires a localhost PostgreSQL DATABASE_URL with a username, password and database name. See .env.example.");
  }
  const directory = resolve(".data/postgresql");
  const port = Number(url.port || 5432);
  server = new EmbeddedPostgres({ databaseDir: directory, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), port, persistent: true,
    authMethod: "scram-sha-256", initdbFlags: ["--encoding=UTF8", "--locale=C"], postgresFlags: ["-h", "127.0.0.1"], onLog() {}, onError(message) { console.error(String(message)); } });
  if (!existsSync(resolve(directory, "PG_VERSION"))) await server.initialise();
  await server.start();
  await server.createDatabase(name);
  console.log(`Local PostgreSQL is ready on 127.0.0.1:${port}. Data: .data/postgresql. Keep this terminal open; Ctrl+C stops the service.`);
  await new Promise(done => { process.once("SIGINT", done); process.once("SIGTERM", done); });
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (server) await server.stop(); }
