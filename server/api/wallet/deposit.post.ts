import { assertSameOrigin, randomUUID, rateLimit, requireUser } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { platformSettings } from "../../utils/admin";
import { moneyScale, parseAmount, parseRequestKey, walletFor, walletRow } from "../../utils/wallet";

export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  const user = requireUser(event);
  if (!platformSettings().fundingOpen) throw createError({ statusCode: 403, statusMessage: "Funding requests are temporarily paused." });
  rateLimit(event, `deposit:${user.id}`, 30);
  const body = await readBody(event);
  const amount = parseAmount(body?.amount);
  const key = parseRequestKey(body?.requestKey);
  transaction(() => {
    const wallet = walletRow(user.id);
    const previous = db().prepare("SELECT type, amount FROM wallet_transactions WHERE wallet_id = ? AND request_key = ?").get(wallet.id, key) as { type: string; amount: number } | undefined;
    if (previous) {
      if (previous.type !== "deposit" || previous.amount !== amount) throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
      return;
    }
    db().prepare("INSERT INTO wallet_transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), wallet.id, "deposit", amount, "pending", `Funding request · ${(amount / moneyScale).toFixed(2)} USDT`, key, new Date().toISOString());
  });
  return walletFor(user.id);
});
