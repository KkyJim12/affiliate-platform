import { assertSameOrigin, rateLimit, requireAdmin } from "../../../utils/auth";
import { db, transaction } from "../../../utils/database";
import { audit } from "../../../utils/admin";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const admin = requireAdmin(event);
  rateLimit(event, `admin-users:${admin.id}`, 60);
  const id = getRouterParam(event, "id");
  const body = await readBody(event);
  if (!id || !["active", "suspended"].includes(body?.status)) throw createError({ statusCode: 400, statusMessage: "Choose a valid account status." });
  transaction(() => {
    const user = db().prepare(`SELECT u.username, COALESCE(a.role, 'member') AS role, COALESCE(a.status, 'active') AS status FROM users u LEFT JOIN user_access a ON a.user_id = u.id WHERE u.id = ?`).get(id) as { username: string; role: string; status: string } | undefined;
    if (!user) throw createError({ statusCode: 404, statusMessage: "That username was not found." });
    if (user.role === "admin") throw createError({ statusCode: 403, statusMessage: "Administrator accounts cannot be suspended here." });
    if (user.status === body.status) return;
    db().prepare("INSERT INTO user_access (user_id, status) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET status = excluded.status").run(id, body.status);
    if (body.status === "suspended") db().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
    audit(admin.id, body.status === "suspended" ? "user_suspended" : "user_activated", user.username);
  });
  return { ok: true };
});
