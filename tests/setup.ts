import { openTestDatabase } from "./database";
import { migrate, readMigrations } from "../server/lib/migrations";

export default async function setup() {
  // Reset throttles and operational controls only in the dedicated test database.
  const database = openTestDatabase();
  try {
    await migrate(database.pool, readMigrations());
    await database.execute("DELETE FROM rate_limits");
    await database.execute("UPDATE platform_settings SET registration_open = 1, funding_open = 1, support_email = '' WHERE id = 1");
  } finally { await database.close(); }
}
