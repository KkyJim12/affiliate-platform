import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { H3Event } from "h3";
import { db } from "./database";
import type { Account } from "../../shared/types";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  referral_code: string;
  sponsor_id: string | null;
  created_at: string;
}

const cookieName = "loop_session";
const sessionLifetime = 7 * 24 * 60 * 60;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}

export async function verifyPassword(password: string, stored?: string) {
  const [salt, expected] = (stored || `${"0".repeat(32)}:${"0".repeat(128)}`).split(":");
  const actual = await derive(password, salt!);
  return timingSafeEqual(actual, Buffer.from(expected!, "hex"));
}

export function assertSameOrigin(event: H3Event) {
  const origin = getHeader(event, "origin");
  if (!origin || origin !== getRequestURL(event).origin || getHeader(event, "sec-fetch-site") === "cross-site") {
    throw createError({ statusCode: 403, statusMessage: "This request must come from Loop." });
  }
}

export function rateLimit(event: H3Event, scope: string, limit = 12) {
  const key = hashToken(`${scope}:${getRequestIP(event) || "unknown"}`);
  const now = Date.now();
  db().prepare("DELETE FROM rate_limits WHERE resets_at < ?").run(now);
  const result = db().prepare(`
    INSERT INTO rate_limits (key, count, resets_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count
  `).get(key, now + 15 * 60 * 1000) as { count: number };
  if (result.count > limit) {
    setHeader(event, "Retry-After", 900);
    throw createError({ statusCode: 429, statusMessage: "Too many attempts. Please try again in 15 minutes." });
  }
}

export function accountFor(user: UserRow): Account {
  const sponsor = user.sponsor_id
    ? db().prepare("SELECT referral_code FROM users WHERE id = ?").get(user.sponsor_id) as { referral_code: string } | undefined
    : undefined;
  return { id: user.id, username: user.username, referralCode: user.referral_code, sponsorCode: sponsor?.referral_code || null, createdAt: user.created_at };
}

export function currentUser(event: H3Event): UserRow | undefined {
  const token = getCookie(event, cookieName);
  if (!token) return;
  return db().prepare(`
    SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now()) as UserRow | undefined;
}

export function requireUser(event: H3Event) {
  const user = currentUser(event);
  if (!user) throw createError({ statusCode: 401, statusMessage: "Sign in to access your account." });
  return user;
}

export function createSession(event: H3Event, userId: string) {
  const previous = getCookie(event, cookieName);
  if (previous) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(previous));
  db().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  const token = randomBytes(32).toString("hex");
  db().prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(hashToken(token), userId, Date.now() + sessionLifetime * 1000);
  setCookie(event, cookieName, token, { httpOnly: true, sameSite: "strict", secure: getRequestURL(event).protocol === "https:", path: "/", maxAge: sessionLifetime });
}

export function removeSession(event: H3Event) {
  const token = getCookie(event, cookieName);
  if (token) db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  deleteCookie(event, cookieName, { path: "/" });
}

export { randomUUID };
