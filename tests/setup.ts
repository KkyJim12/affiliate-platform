import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export default function setup() {
  // Only reset throttles in the dedicated test database so repeated runs are isolated.
  const path = resolve(".data/playwright.sqlite");
  if (!existsSync(path)) return;
  const database = new DatabaseSync(path);
  const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rate_limits'").get();
  if (table) database.exec("DELETE FROM rate_limits");
  database.close();
}
