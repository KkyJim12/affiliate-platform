import { accountFor, assertSameOrigin, createSession, hashPassword, randomUUID, rateLimit, type UserRow } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { platformSettings } from "../../utils/admin";
import { activeSponsor } from "../../utils/referral";

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  rateLimit(event, "register", 10);
  if (!platformSettings().registrationOpen) throw createError({ statusCode: 403, statusMessage: "New registrations are temporarily paused." });
  const body = await readBody(event);
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const sponsorCode = typeof body?.sponsorCode === "string" ? body.sponsorCode.trim().toUpperCase() : "";
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) throw createError({ statusCode: 400, statusMessage: "Use 3–24 letters, numbers, or underscores. Start with a letter." });
  if (password.length < 12 || password.length > 128) throw createError({ statusCode: 400, statusMessage: "Choose a password between 12 and 128 characters." });
  if (db().prepare("SELECT id FROM users WHERE username = ?").get(username)) throw createError({ statusCode: 409, statusMessage: "That username is already taken." });
  const sponsor = sponsorCode ? activeSponsor(sponsorCode) : undefined;
  if (sponsorCode && !sponsor) throw createError({ statusCode: 400, statusMessage: "That invite code was not found. Check it or leave it blank." });
  const user: UserRow = { id: randomUUID(), username, password_hash: await hashPassword(password), referral_code: `UNASSIGNED-${randomUUID()}`, sponsor_id: sponsor?.id || null, created_at: new Date().toISOString() };
  try {
    transaction(() => {
      if (sponsorCode && activeSponsor(sponsorCode)?.id !== sponsor?.id) throw createError({ statusCode: 400, statusMessage: "That invite code was not found. Check it or leave it blank." });
      db().prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)").run(user.id, user.username, user.password_hash, user.referral_code, user.sponsor_id, user.created_at);
      db().prepare("INSERT INTO wallets (id, user_id) VALUES (?, ?)").run(`LW-${randomUUID()}`, user.id);
    });
  } catch (error) {
    if (String(error).includes("users.username")) throw createError({ statusCode: 409, statusMessage: "That username is already taken." });
    throw error;
  }
  createSession(event, user.id);
  setResponseStatus(event, 201);
  return { user: accountFor(user) };
});
