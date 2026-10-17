import { assertSameOrigin, randomUUID, rateLimit, requireUser, verifyPassword, type UserRow } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { parseAmount, parseRequestKey, walletFor, walletRow } from "../../utils/wallet";

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  const user = requireUser(event);
  rateLimit(event, `transfer:${user.id}`, 15);
  const body = await readBody(event);
  const amount = parseAmount(body?.amount);
  const key = parseRequestKey(body?.requestKey);
  const recipientName = typeof body?.recipient === "string" ? body.recipient.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length > 128 || !await verifyPassword(password, user.password_hash)) throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
  const recipient = db().prepare("SELECT * FROM users WHERE username = ?").get(recipientName) as UserRow | undefined;
  if (!recipient) throw createError({ statusCode: 400, statusMessage: "That username was not found." });
  if (recipient.id === user.id) throw createError({ statusCode: 400, statusMessage: "Choose another member to receive this transfer." });
  transaction(() => {
    const senderWallet = walletRow(user.id);
    const receiverWallet = walletRow(recipient.id);
    const description = `Transfer to @${recipient.username}`;
    const previous = db().prepare("SELECT type, amount, description FROM wallet_transactions WHERE wallet_id = ? AND request_key = ?").get(senderWallet.id, key) as { type: string; amount: number; description: string } | undefined;
    if (previous) {
      if (previous.type !== "transfer_out" || previous.amount !== amount || previous.description !== description) throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
      return;
    }
    if (senderWallet.available < amount) throw createError({ statusCode: 400, statusMessage: "Your available balance is too low for this transfer." });
    if (!Number.isSafeInteger(receiverWallet.available + amount)) throw createError({ statusCode: 409, statusMessage: "The recipient wallet cannot accept this amount." });
    db().prepare("UPDATE wallets SET available = available - ? WHERE id = ?").run(amount, senderWallet.id);
    db().prepare("UPDATE wallets SET available = available + ? WHERE id = ?").run(amount, receiverWallet.id);
    const insert = db().prepare("INSERT INTO wallet_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const timestamp = new Date().toISOString();
    insert.run(randomUUID(), senderWallet.id, "transfer_out", amount, "completed", description, key, timestamp);
    insert.run(randomUUID(), receiverWallet.id, "transfer_in", amount, "completed", `Transfer from @${user.username}`, key, timestamp);
  });
  return walletFor(user.id);
});
