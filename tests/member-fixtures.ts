import { execFileSync } from "node:child_process";
import { openTestDatabase } from "./database";

export function createTestAdmin(password: string) {
  const output = execFileSync(process.execPath, ["scripts/create-admin.mjs"], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, LOOP_ADMIN_PASSWORD: password },
  });
  const memberId = output.match(/Administrator ID ([1-9][0-9]*) created/)?.[1];
  if (!memberId || output.includes(password)) throw new Error("Administrator setup did not return a safe member ID.");
  return memberId;
}

export async function memberIdFor(id: string) {
  const database = openTestDatabase();
  try {
    const user = await database.one("SELECT referral_code FROM users WHERE id = $1", id);
    if (!user) throw new Error("Fixture account was not found.");
    return user.referral_code as string;
  } finally { await database.close(); }
}
