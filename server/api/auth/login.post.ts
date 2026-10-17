import { accountFor, assertSameOrigin, createSession, rateLimit, verifyPassword, type UserRow } from "../../utils/auth";
import { db } from "../../utils/database";

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  rateLimit(event, "login", 30);
  const body = await readBody(event);
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (username.length > 24 || password.length > 128 || !password) throw createError({ statusCode: 401, statusMessage: "Username or password is incorrect." });
  const user = db().prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
  const valid = await verifyPassword(password, user?.password_hash);
  if (!user || !valid) throw createError({ statusCode: 401, statusMessage: "Username or password is incorrect." });
  createSession(event, user.id);
  return { user: accountFor(user) };
});
