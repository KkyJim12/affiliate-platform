import { accountFor, assertSameOrigin, rateLimit, requireUser, verifyPassword } from "../../utils/auth";
import { buyReferralLevel } from "../../utils/compensation";
import { referralProgram } from "../../utils/referral";
import { parseRequestKey, walletFor } from "../../utils/wallet";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    const user = await requireUser(event);
    await rateLimit(event, `referral-activation:${user.id}`, 12);
    const body = await readBody(event);
    const key = parseRequestKey(body?.requestKey);
    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length > 128 || !await verifyPassword(password, user.password_hash))
        throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
    await buyReferralLevel(user.id, 1, key);
    return { user: await accountFor(user), wallet: await walletFor(user.id), program: await referralProgram(user.id) };
});
