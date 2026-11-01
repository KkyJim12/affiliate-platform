import { execFileSync } from "node:child_process";
import { openTestDatabase } from "./database";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../server/lib/password";

export async function createTestAdmin(password: string) {
  const database = openTestDatabase(), id = randomUUID(), wallet = `LW-${id}`, payment = randomUUID();
  let existingMemberId: string;
  try {
    await database.transaction(async () => {
      await database.execute("INSERT INTO users VALUES($1,$1,$2,NULL,NULL,$3)",id,await hashPassword(password),new Date().toISOString());
      await database.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",wallet,id);
      await database.execute("INSERT INTO wallet_transactions VALUES($1,$2,'referral_purchase',10000000,'completed','Historical fixture purchase',$1,$3)",payment,wallet,new Date().toISOString());
      await database.execute("INSERT INTO referral_activations(user_id,transaction_id,created_at) VALUES($1,$2,$3)",id,payment,new Date().toISOString());
    });
    existingMemberId = (await database.one("SELECT referral_code FROM users WHERE id=$1",id))!.referral_code;
  } finally { await database.close(); }
  const output = execFileSync(process.execPath, ["scripts/create-admin.mjs"], {
    encoding: "utf8", env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, LOOP_ADMIN_PASSWORD: password, LOOP_ADMIN_MEMBER_ID: existingMemberId },
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
