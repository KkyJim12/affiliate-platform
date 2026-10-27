import { accountFor, assertSameOrigin, createSession, findUserByMemberId, rateLimit, verifyPassword } from "../../utils/auth";
import { isMemberId } from "../../../shared/referral-code";
import { ensureEvmWallet } from "../../utils/evm-wallet";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    await rateLimit(event, "admin-login", 15);
    const body = await readBody(event);
    const memberId = typeof body?.memberId === "string" ? body.memberId.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!isMemberId(memberId) || !password || password.length > 128)
        throw createError({ statusCode: 401, statusMessage: "Administrator credentials are incorrect." });
    const user = await findUserByMemberId(memberId);
    const valid = await verifyPassword(password, user?.password_hash);
    if (!user || !valid || user.role !== "admin" || user.status !== "active")
        throw createError({ statusCode: 401, statusMessage: "Administrator credentials are incorrect." });
    await ensureEvmWallet(user.id, password);
    await createSession(event, user.id);
    return { user: await accountFor(user) };
});
