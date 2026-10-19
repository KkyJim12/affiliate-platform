import { assertSameOrigin, randomUUID, rateLimit, requireUser } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { platformSettings } from "../../utils/admin";
import { moneyScale, parseAmount, parseRequestKey, walletFor, walletRow } from "../../utils/wallet";
import { requireEmbeddedWalletMode } from "../../utils/wallet-mode";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    requireEmbeddedWalletMode();
    const user = await requireUser(event);
    if (!(await platformSettings()).fundingOpen)
        throw createError({ statusCode: 403, statusMessage: "Funding requests are temporarily paused." });
    await rateLimit(event, `deposit:${user.id}`, 30);
    const body = await readBody(event);
    const amount = parseAmount(body?.amount);
    const key = parseRequestKey(body?.requestKey);
    await transaction(async () => {
        const wallet = await walletRow(user.id, true);
        const previous = await db().one("SELECT type, amount FROM wallet_transactions WHERE wallet_id = $1 AND request_key = $2", wallet.id, key) as {
            type: string;
            amount: number;
        } | undefined;
        if (previous) {
            if (previous.type !== "deposit" || previous.amount !== amount)
                throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
            return;
        }
        await db().execute("INSERT INTO wallet_transactions VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", randomUUID(), wallet.id, "deposit", amount, "pending", `Funding request \u00B7 ${(amount / moneyScale).toFixed(2)} USDT`, key, new Date().toISOString());
    });
    return await walletFor(user.id);
});
