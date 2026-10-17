import { accountFor, assertSameOrigin, createSession, findUser, rateLimit, verifyPassword } from "../../utils/auth";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    await rateLimit(event, "admin-login", 15);
    const body = await readBody(event);
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (username.length > 24 || !password || password.length > 128)
        throw createError({ statusCode: 401, statusMessage: "Administrator credentials are incorrect." });
    const user = await findUser(username);
    const valid = await verifyPassword(password, user?.password_hash);
    if (!user || !valid || user.role !== "admin" || user.status !== "active")
        throw createError({ statusCode: 401, statusMessage: "Administrator credentials are incorrect." });
    await createSession(event, user.id);
    return { user: await accountFor(user) };
});
