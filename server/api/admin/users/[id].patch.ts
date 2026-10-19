import { assertSameOrigin, rateLimit, requireAdmin } from "../../../utils/auth";
import { db, transaction } from "../../../utils/database";
import { audit } from "../../../utils/admin";
import { updateUsername } from "../../../utils/username";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    const admin = await requireAdmin(event);
    await rateLimit(event, `admin-users:${admin.id}`, 60);
    const id = getRouterParam(event, "id");
    const body = await readBody(event);
    const hasUsername = body?.username !== undefined;
    const hasStatus = body?.status !== undefined;
    if (!id || (!hasUsername && !hasStatus) || (hasStatus && !["active", "suspended"].includes(body.status)))
        throw createError({ statusCode: 400, statusMessage: "Choose a valid account status." });
    await transaction(async () => {
        const user = await db().one(`SELECT u.username, COALESCE(a.role, 'member') AS role, COALESCE(a.status, 'active') AS status FROM users u LEFT JOIN user_access a ON a.user_id = u.id WHERE u.id = $1 FOR UPDATE OF u`, id) as {
            username: string;
            role: string;
            status: string;
        } | undefined;
        if (!user)
            throw createError({ statusCode: 404, statusMessage: "That username was not found." });
        if (hasStatus && user.role === "admin")
            throw createError({ statusCode: 403, statusMessage: "Administrator accounts cannot be suspended here." });
        if (hasUsername) {
            const username = await updateUsername(id, body.username);
            if (username !== user.username)
                await audit(admin.id, "user_username_changed", `${user.username} -> ${username}`);
        }
        if (!hasStatus || user.status === body.status)
            return;
        await db().execute("INSERT INTO user_access (user_id, status) VALUES ($1, $2) ON CONFLICT(user_id) DO UPDATE SET status = excluded.status", id, body.status);
        if (body.status === "suspended")
            await db().execute("DELETE FROM sessions WHERE user_id = $1", id);
        await audit(admin.id, body.status === "suspended" ? "user_suspended" : "user_activated", user.username);
    });
    return { ok: true };
});
