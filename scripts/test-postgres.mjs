import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { createServer } from "node:net";

const mode = process.argv[2];
if (!["db", "ui"].includes(mode)) throw new Error("Choose db or ui tests.");
let server, directory;
let testExitCode = 1;
try {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    await mkdir(resolve(".data"), { recursive: true });
    directory = await mkdtemp(resolve(".data/postgres-test-"));
    const port = await new Promise((resolvePort, reject) => {
      const socket = createServer();
      socket.on("error", reject);
      socket.listen(0, "127.0.0.1", () => { const port = socket.address().port; socket.close(() => resolvePort(port)); });
    });
    const password = randomUUID();
    server = new EmbeddedPostgres({ databaseDir: resolve(directory, "cluster"), user: "unxo_test", password, port, persistent: true,
      authMethod: "scram-sha-256", initdbFlags: ["--encoding=UTF8", "--locale=C"], postgresFlags: ["-h", "127.0.0.1"], onLog() {}, onError(message) { console.error(String(message)); } });
    await server.initialise();
    await server.start();
    await server.createDatabase("unxo_test");
    url = `postgresql://unxo_test:${password}@127.0.0.1:${port}/unxo_test`;
  }
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("TEST_DATABASE_URL must point to a disposable database whose name ends with _test.");
  const args = mode === "db" ? ["--test", ...process.argv.slice(3), "tests/migrations.test.mjs"] : ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(3)];
  const child = spawn(process.execPath, args, { stdio: "inherit", env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url } });
  testExitCode = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", code => done(code ?? 1)); });
} catch (error) { console.error(error.message); testExitCode = 1; }
finally {
  if (server) await server.stop();
  if (directory) {
    if (dirname(resolve(directory)) !== resolve(".data") || !basename(directory).startsWith("postgres-test-")) throw new Error("Refusing to remove an unexpected test directory.");
    await rm(directory, { recursive: true, force: true });
  }
}
// embedded-postgres installs a beforeExit hook that otherwise forces code 0.
// All asynchronous database shutdown and file cleanup has completed above.
process.exit(testExitCode);
