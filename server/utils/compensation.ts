import { createError } from "h3";
import { ledgerScale, levelPrice, maxReferralLevel, purchaseShares } from "../../shared/compensation";
import { db, transaction } from "./database";
import { randomUUID } from "./auth";
import { newReferralCode } from "./referral";
import { walletRow } from "./wallet";
import { referralPaymentMode } from "./referral-chain";

interface Upline { id: string; depth: number; eligible: boolean; wallet_id: string | null }

export async function buyReferralLevel(userId: string, level: number, requestKey: string) {
  if (referralPaymentMode() !== "ledger")
    throw createError({ statusCode: 409, statusMessage: "Use the smart contract purchase flow to pay from your Amoy wallet." });
  if (!Number.isInteger(level) || level < 1 || level > maxReferralLevel)
    throw createError({ statusCode: 400, statusMessage: "Choose a referral level between 1 and 15." });
  return transaction(async () => {
    // Share the genealogy lock with sponsor changes, then lock ALL affected wallets
    // in transfer order. This prevents graph races and opposite wallet deadlocks.
    await db().execute("SELECT pg_advisory_xact_lock(782438, 2)");
    const activation = await db().one("SELECT user_id FROM referral_activations WHERE user_id = $1", userId);
    if (level === 1 && activation) return;
    const previous = await db().one(`SELECT p.level FROM referral_purchases p JOIN wallet_transactions t ON t.id = p.transaction_id
      WHERE p.user_id = $1 AND t.request_key = $2`, userId, requestKey);
    if (previous) {
      if (previous.level !== level) throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
      return;
    }
    const current = await db().one("SELECT COALESCE(MAX(level), $2::INTEGER) AS level FROM referral_purchases WHERE user_id = $1", userId, activation ? 1 : 0);
    if (level !== current!.level + 1)
      throw createError({ statusCode: 409, statusMessage: "Purchase the next referral level in order. The maximum is level 15." });
    const settings = await db().one("SELECT fee_recipient_address FROM platform_settings WHERE id = 1 FOR SHARE") as { fee_recipient_address: string };
    if (!settings.fee_recipient_address)
      throw createError({ statusCode: 409, statusMessage: "Referral purchases are unavailable until an administrator sets the platform fee address." });
    const uplines = await db().all(`WITH RECURSIVE ancestors AS (
      SELECT s.id, s.sponsor_id, 1 AS depth, ARRAY[$1::TEXT, s.id] AS path
      FROM users buyer JOIN users s ON s.id = buyer.sponsor_id WHERE buyer.id = $1 AND s.id <> buyer.id
      UNION ALL SELECT s.id, s.sponsor_id, a.depth + 1, a.path || s.id
      FROM ancestors a JOIN users s ON s.id = a.sponsor_id
      WHERE a.depth < 15 AND NOT s.id = ANY(a.path)
    ) SELECT a.id, a.depth, w.id AS wallet_id,
      (r.user_id IS NOT NULL AND COALESCE(access.status, 'active') = 'active' AND w.id IS NOT NULL) AS eligible
      FROM ancestors a LEFT JOIN referral_activations r ON r.user_id = a.id
      LEFT JOIN user_access access ON access.user_id = a.id LEFT JOIN wallets w ON w.user_id = a.id ORDER BY a.depth`, userId) as unknown as Upline[];
    const recipients = uplines.filter(upline => upline.eligible);
    await db().all("SELECT id FROM wallets WHERE user_id = ANY($1::TEXT[]) ORDER BY id FOR UPDATE", [userId, ...recipients.map(upline => upline.id)]);
    const wallet = await walletRow(userId);
    const price = levelPrice(level) * ledgerScale;
    if (wallet.available < price)
      throw createError({ statusCode: 400, statusMessage: "Your available USDT credit balance is too low for this referral purchase." });
    if (await db().one("SELECT id FROM wallet_transactions WHERE wallet_id = $1 AND request_key = $2", wallet.id, requestKey))
      throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
    const id = randomUUID(), transactionId = randomUUID(), timestamp = new Date().toISOString();
    await db().execute("UPDATE wallets SET available = available - $1 WHERE id = $2", price, wallet.id);
    await db().execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'referral_purchase', $3, 'completed', $4, $5, $6)",
      transactionId, wallet.id, price, level === 1 ? "Referral activation" : `Referral level ${level} purchase`, requestKey, timestamp);
    await db().execute(`INSERT INTO referral_purchases (id, user_id, level, amount, transaction_id, fee_recipient_address, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, id, userId, level, price, transactionId, settings.fee_recipient_address, timestamp);
    if (level === 1) {
      await db().execute("UPDATE users SET referral_code = $1 WHERE id = $2", await newReferralCode(), userId);
      await db().execute("INSERT INTO referral_activations (user_id, transaction_id, created_at) VALUES ($1, $2, $3)", userId, transactionId, timestamp);
    }
    for (const share of purchaseShares(level)) {
      const upline = uplines.find(item => item.depth === share.depth);
      const recipient = upline?.eligible ? upline : undefined;
      const creditId = recipient ? randomUUID() : null;
      if (recipient) {
        await db().execute("UPDATE wallets SET available = available + $1 WHERE id = $2", share.units, recipient.wallet_id);
        await db().execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'commission', $3, 'completed', $4, $5, $6)",
          creditId, recipient.wallet_id, share.units, `Referral ${share.kind} commission · level ${level} · upline ${share.depth}`,
          `referral:${id}:${share.kind}:${share.depth}`, timestamp);
      }
      await db().execute(`INSERT INTO referral_allocations
        (id, purchase_id, kind, depth, amount, recipient_user_id, recipient_address, transaction_id, status, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        randomUUID(), id, share.kind, share.depth, share.units, recipient?.id ?? null,
        recipient ? null : settings.fee_recipient_address, creditId, recipient ? "credited" : "payable",
        share.kind === "platform" ? "platform_fee" : recipient ? "upline" : upline ? "ineligible_upline" : "missing_upline");
    }
  });
}
