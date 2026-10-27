import { assertSameOrigin, rateLimit, requireAdmin } from "../../../utils/auth";
import { db, transaction } from "../../../utils/database";
import { audit } from "../../../utils/admin";
export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const admin = await requireAdmin(event);
  await rateLimit(event, `admin-users:${admin.id}`, 60);
  const id = getRouterParam(event, "id"), body = await readBody(event);
  if (!id || !body || Object.keys(body).some(key => key !== "status") || !["active", "suspended"].includes(body.status))
    throw createError({ statusCode: 400, statusMessage: "Choose a valid account status. Member IDs cannot be changed." });
  await transaction(async () => {
    const user = await db().one(`SELECT COALESCE(a.role,'member') AS role, COALESCE(a.status,'active') AS status
      FROM users u LEFT JOIN user_access a ON a.user_id = u.id WHERE u.id = $1 FOR UPDATE OF u`, id);
    if (!user) throw createError({ statusCode: 404, statusMessage: "That member ID was not found." });
    if (user.role === "admin") throw createError({ statusCode: 403, statusMessage: "Administrator accounts cannot be suspended here." });
    if (user.status === body.status) return;
    await db().execute("INSERT INTO user_access (user_id,status) VALUES ($1,$2) ON CONFLICT(user_id) DO UPDATE SET status = excluded.status", id, body.status);
    if (body.status === "suspended") await db().execute("DELETE FROM sessions WHERE user_id = $1", id);
    await audit(admin.id, body.status === "suspended" ? "user_suspended" : "user_activated", id);
  });
  return { ok: true };
});
