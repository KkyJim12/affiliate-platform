import { createDatabase } from "../server/lib/postgres";

export function openTestDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Run browser tests with npm run test:ui using a disposable PostgreSQL test database.");
  return createDatabase(url);
}
