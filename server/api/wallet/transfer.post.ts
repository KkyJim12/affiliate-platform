import { assertSameOrigin, findUser, randomUUID, rateLimit, requireUser, verifyPassword } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { parseAmount, parseRequestKey, walletFor, walletRow } from "../../utils/wallet";
import { requireEmbeddedWalletMode } from "../../utils/wallet-mode";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    requireEmbeddedWalletMode();
    const user = await requireUser(event);
    await rateLimit(event, `transfer:${user.id}`, 15);
    const body = await readBody(event);
    const amount = parseAmount(body?.amount);
    const key = parseRequestKey(body?.requestKey);
    const recipientName = typeof body?.recipient === "string" ? body.recipient.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length > 128 || !await verifyPassword(password, user.password_hash))
        throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
    const recipient = await findUser(recipientName);
    if (!recipient || recipient.status !== "active")
        throw createError({ statusCode: 400, statusMessage: "That username was not found." });
    if (recipient.id === user.id)
        throw createError({ statusCode: 400, statusMessage: "Choose another member to receive this transfer." });
    await transaction(async () => {
        // Both directions take wallet locks in the same order to avoid deadlocks.
        await db().all("SELECT id FROM wallets WHERE user_id IN ($1, $2) ORDER BY id FOR UPDATE", user.id, recipient.id);
        const senderWallet = await walletRow(user.id);
        const receiverWallet = await walletRow(recipient.id);
        const description = `Transfer to @${recipient.username}`;
        const previous = await db().one("SELECT type, amount, description FROM wallet_transactions WHERE wallet_id = $1 AND request_key = $2", senderWallet.id, key) as {
            type: string;
            amount: number;
            description: string;
        } | undefined;
        if (previous) {
            if (previous.type !== "transfer_out" || previous.amount !== amount || previous.description !== description)
                throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
            return;
        }
        if (senderWallet.available < amount)
            throw createError({ statusCode: 400, statusMessage: "Your available balance is too low for this transfer." });
        if (!Number.isSafeInteger(receiverWallet.available + amount))
            throw createError({ statusCode: 409, statusMessage: "The recipient wallet cannot accept this amount." });
        await db().execute("UPDATE wallets SET available = available - $1 WHERE id = $2", amount, senderWallet.id);
        await db().execute("UPDATE wallets SET available = available + $1 WHERE id = $2", amount, receiverWallet.id);
        const timestamp = new Date().toISOString();
        await db().execute("INSERT INTO wallet_transactions VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", randomUUID(), senderWallet.id, "transfer_out", amount, "completed", description, key, timestamp);
        await db().execute("INSERT INTO wallet_transactions VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", randomUUID(), receiverWallet.id, "transfer_in", amount, "completed", `Transfer from @${user.username}`, key, timestamp);
    });
    return await walletFor(user.id);
});
