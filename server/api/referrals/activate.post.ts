import { referralPrice } from "../../../shared/referral";
import { accountFor, assertSameOrigin, findUser, randomUUID, rateLimit, requireUser, verifyPassword } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { newReferralCode, referralProgram } from "../../utils/referral";
import { moneyScale, parseRequestKey, walletFor, walletRow } from "../../utils/wallet";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    const user = await requireUser(event);
    await rateLimit(event, `referral-activation:${user.id}`, 12);
    const body = await readBody(event);
    const key = parseRequestKey(body?.requestKey);
    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length > 128 || !await verifyPassword(password, user.password_hash))
        throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
    await transaction(async () => {
        const wallet = await walletRow(user.id, true);
        if (await db().one("SELECT user_id FROM referral_activations WHERE user_id = $1", user.id))
            return;
        const price = referralPrice * moneyScale;
        if (wallet.available < price)
            throw createError({ statusCode: 400, statusMessage: "You need 10 USDT in your available wallet balance to activate referrals." });
        if (await db().one("SELECT id FROM wallet_transactions WHERE wallet_id = $1 AND request_key = $2", wallet.id, key))
            throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
        const transactionId = randomUUID(), timestamp = new Date().toISOString();
        await db().execute("UPDATE wallets SET available = available - $1 WHERE id = $2", price, wallet.id);
        await db().execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'referral_purchase', $3, 'completed', 'Referral activation', $4, $5)", transactionId, wallet.id, price, key, timestamp);
        await db().execute("UPDATE users SET referral_code = $1 WHERE id = $2", await newReferralCode(), user.id);
        await db().execute("INSERT INTO referral_activations VALUES ($1, $2, $3)", user.id, transactionId, timestamp);
    });
    return { user: await accountFor((await findUser(user.username))!), wallet: await walletFor(user.id), program: await referralProgram(user.id) };
});
