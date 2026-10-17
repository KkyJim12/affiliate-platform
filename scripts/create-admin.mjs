import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { db, transaction } from "../server/utils/database.ts";
import { hashPassword } from "../server/lib/password.ts";

try {
  let username = process.env.LOOP_ADMIN_USERNAME || "";
  let password = process.env.LOOP_ADMIN_PASSWORD || "";
  if ((!username || !password) && process.stdin.isTTY) {
    let hidden = false;
    const output = new Writable({ write(chunk, _encoding, done) { if (!hidden) process.stdout.write(chunk); done(); } });
    const prompt = createInterface({ input: process.stdin, output, terminal: true });
    prompt.on("SIGINT", () => { prompt.close(); process.exit(1); });
    try {
      if (!username) username = await prompt.question("Admin username: ");
      if (!password) {
        process.stdout.write("Admin password (12-128 characters, hidden): ");
        hidden = true;
        password = await prompt.question("");
        hidden = false;
        process.stdout.write("\n");
      }
    } finally { prompt.close(); }
  }
  username = username.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username) || password.length < 12 || password.length > 128) throw new Error("Provide a username (3-24 letters, numbers, underscores, starting with a letter) and a password (12-128 characters). Non-interactive setup uses LOOP_ADMIN_USERNAME and LOOP_ADMIN_PASSWORD.");
  const database = db();
  if (database.prepare("SELECT id FROM users WHERE username = ?").get(username)) throw new Error("That username already exists. Choose a new administrator username.");
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  transaction(() => {
    database.prepare("INSERT INTO users (id, username, password_hash, referral_code, sponsor_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)").run(id, username, passwordHash, `LOOP-${randomUUID().slice(0, 8).toUpperCase()}`, new Date().toISOString());
    database.prepare("INSERT INTO wallets (id, user_id) VALUES (?, ?)").run(`LW-${randomUUID()}`, id);
    database.prepare("INSERT INTO user_access (user_id, role) VALUES (?, 'admin')").run(id);
    database.prepare("INSERT INTO admin_audit VALUES (?, ?, 'admin_created', ?, ?)").run(randomUUID(), id, username, new Date().toISOString());
  });
  console.log(`Administrator @${username} created. Sign in at /admin/login.`);
  database.close();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
