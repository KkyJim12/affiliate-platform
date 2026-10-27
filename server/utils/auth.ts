import { createHash, randomBytes, randomUUID } from "node:crypto";
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
    role?: "member" | "admin";
    status?: "active" | "suspended";
}
const cookieName = "loop_session";
const sessionLifetime = 7 * 24 * 60 * 60;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export { hashPassword, verifyPassword } from "../lib/password";
export function assertSameOrigin(event: H3Event) {
    const origin = getHeader(event, "origin");
    if (!origin || origin !== getRequestURL(event).origin || getHeader(event, "sec-fetch-site") === "cross-site") {
        throw createError({ statusCode: 403, statusMessage: "This request must come from Loop." });
    }
}
export async function rateLimit(event: H3Event, scope: string, limit = 12) {
    const key = hashToken(`${scope}:${getRequestIP(event) || "unknown"}`);
    const now = Date.now();
    await db().execute("DELETE FROM rate_limits WHERE resets_at < $1", now);
    const result = await db().one(`
    INSERT INTO rate_limits (key, count, resets_at) VALUES ($1, 1, $2)
    ON CONFLICT(key) DO UPDATE SET count = rate_limits.count + 1 RETURNING count
  `, key, now + 15 * 60 * 1000) as {
        count: number;
    };
    if (result.count > limit) {
        setHeader(event, "Retry-After", 900);
        throw createError({ statusCode: 429, statusMessage: "Too many attempts. Please try again in 15 minutes." });
    }
}
export async function accountFor(user: UserRow): Promise<Account> {
    const identity = await db().one("SELECT referral_code, sponsor_id FROM users WHERE id = $1", user.id);
    const activation = await db().one("SELECT user_id FROM referral_activations WHERE user_id = $1", user.id);
    const sponsor = identity!.sponsor_id
        ? await db().one("SELECT referral_code FROM users WHERE id = $1", identity!.sponsor_id) as {
            referral_code: string;
        } | undefined
        : undefined;
    return { id: user.id, memberId: identity!.referral_code, referralCode: activation ? identity!.referral_code : null, sponsorCode: sponsor?.referral_code || null, createdAt: user.created_at, role: user.role || "member" };
}
export async function currentUser(event: H3Event): Promise<UserRow | undefined> {
    const token = getCookie(event, cookieName);
    if (!token)
        return;
    return await db().one(`
    SELECT users.*, COALESCE(user_access.role, 'member') AS role FROM sessions JOIN users ON users.id = sessions.user_id
    LEFT JOIN user_access ON user_access.user_id = users.id
    WHERE sessions.token_hash = $1 AND sessions.expires_at > $2
      AND COALESCE(user_access.status, 'active') = 'active'
  `, hashToken(token), Date.now()) as UserRow | undefined;
}
export async function requireUser(event: H3Event) {
    const user = await currentUser(event);
    if (!user)
        throw createError({ statusCode: 401, statusMessage: "Sign in to access your account." });
    return user;
}
export async function findUserByMemberId(memberId: string) {
    return await db().one(`SELECT users.*, COALESCE(user_access.role, 'member') AS role,
    COALESCE(user_access.status, 'active') AS status FROM users
    LEFT JOIN user_access ON user_access.user_id = users.id WHERE users.referral_code = $1`, memberId) as UserRow | undefined;
}
export async function requireAdmin(event: H3Event) {
    const user = await requireUser(event);
    if (user.role !== "admin")
        throw createError({ statusCode: 403, statusMessage: "Administrator access is required." });
    return user;
}
export async function createSession(event: H3Event, userId: string) {
    const previous = getCookie(event, cookieName);
    if (previous)
        await db().execute("DELETE FROM sessions WHERE token_hash = $1", hashToken(previous));
    await db().execute("DELETE FROM sessions WHERE expires_at <= $1", Date.now());
    const token = randomBytes(32).toString("hex");
    await db().execute("INSERT INTO sessions VALUES ($1, $2, $3)", hashToken(token), userId, Date.now() + sessionLifetime * 1000);
    setCookie(event, cookieName, token, { httpOnly: true, sameSite: "strict", secure: getRequestURL(event).protocol === "https:", path: "/", maxAge: sessionLifetime });
}
export async function removeSession(event: H3Event) {
    const token = getCookie(event, cookieName);
    if (token)
        await db().execute("DELETE FROM sessions WHERE token_hash = $1", hashToken(token));
    deleteCookie(event, cookieName, { path: "/" });
}
export { randomUUID };
