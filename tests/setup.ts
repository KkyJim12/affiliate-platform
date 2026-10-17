import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export default function setup() {
  // Reset throttles and operational controls only in the dedicated test database.
  const path = resolve(".data/playwright.sqlite");
  if (!existsSync(path)) return;
  const database = new DatabaseSync(path);
  const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rate_limits'").get();
  if (table) database.exec("DELETE FROM rate_limits");
  const settings = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'platform_settings'").get();
  if (settings) database.exec("UPDATE platform_settings SET registration_open = 1, funding_open = 1, support_email = '' WHERE id = 1");
  database.close();
}
