import { accountFor, assertSameOrigin, createSession, findUser, rateLimit, verifyPassword } from "../../utils/auth";
import { ensureEvmWallet } from "../../utils/evm-wallet";
import { externalWalletMode, requirePasswordLoginEnabled } from "../../utils/wallet-mode";
import { db } from "../../utils/database";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    requirePasswordLoginEnabled();
    await rateLimit(event, "login", 30);
    const body = await readBody(event);
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (username.length > 24 || password.length > 128 || !password)
        throw createError({ statusCode: 401, statusMessage: "Username or password is incorrect." });
    const user = await findUser(username);
    const valid = await verifyPassword(password, user?.password_hash);
    if (!user || !valid || user.status === "suspended")
        throw createError({ statusCode: 401, statusMessage: "Username or password is incorrect." });
    if (externalWalletMode() && await db().one("SELECT user_id FROM connected_wallets WHERE user_id = $1", user.id))
        throw createError({ statusCode: 403, statusMessage: "This account uses wallet sign-in. Sign a message with your linked wallet." });
    await ensureEvmWallet(user.id, password);
    await createSession(event, user.id);
    return { user: await accountFor(user) };
});
