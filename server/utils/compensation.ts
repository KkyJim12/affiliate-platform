import { referralRecipients, unlockMatrixLevel } from "./matrix";
import { createError } from "h3";
import { ledgerScale, levelPrice, maxReferralLevel, purchaseShares, shareRecipientIndex } from "../../shared/compensation";
import { db, transaction } from "./database";
import { randomUUID } from "./auth";
import { walletRow } from "./wallet";
import { referralPaymentMode } from "./referral-chain";
import { requireEmbeddedWalletMode } from "./wallet-mode";


export async function buyReferralLevel(userId: string, level: number, requestKey: string) {
  requireEmbeddedWalletMode();
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
    const recipients = await referralRecipients(userId, level, "ledger");
    await db().all("SELECT id FROM wallets WHERE user_id = ANY($1::TEXT[]) ORDER BY id FOR UPDATE", [userId, ...recipients.flatMap(item => item.userId ? [item.userId] : [])]);
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
      await db().execute("INSERT INTO referral_activations (user_id, transaction_id, created_at) VALUES ($1, $2, $3)", userId, transactionId, timestamp);
    }
    for (const share of purchaseShares(level)) {
      const position = shareRecipientIndex(share);
      const upline = position >= 0 ? recipients[position]! : null;
      const recipient = upline?.userId ? upline : null;
      const creditId = recipient ? randomUUID() : null;
      if (recipient) {
        await db().execute("UPDATE wallets SET available = available + $1 WHERE id = $2", share.units, recipient.address);
        await db().execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'commission', $3, 'completed', $4, $5, $6)",
          creditId, recipient.address, share.units, `Referral ${share.kind} commission · level ${level} · upline ${share.depth}`,
          `referral:${id}:${share.kind}:${share.depth}`, timestamp);
      }
      await db().execute(`INSERT INTO referral_allocations
        (id, purchase_id, kind, depth, amount, recipient_user_id, recipient_address, transaction_id, status, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        randomUUID(), id, share.kind, share.depth, share.units, recipient?.userId ?? null,
        recipient ? null : settings.fee_recipient_address, creditId, recipient ? "credited" : "payable",
        share.kind === "platform" ? "platform_fee" : recipient ? "upline" : upline?.reason ?? "missing_upline");
    }
    await unlockMatrixLevel(userId, level);
  });
}

let upgrading = false;
export async function processLedgerReferralUpgrades() {
  if (upgrading || referralPaymentMode() !== "ledger") return;
  upgrading = true;
  try {
    const jobs = await db().all<{ cycle_id: string; user_id: string; level: number }>("SELECT * FROM referral_auto_upgrades WHERE status = 'queued' ORDER BY COALESCE(last_attempt_at,created_at),level,cycle_id LIMIT 20");
    for (const job of jobs) {
      await db().execute("UPDATE referral_auto_upgrades SET last_attempt_at = $1 WHERE cycle_id = $2", new Date().toISOString(),job.cycle_id);
      try {
        if (await db().one("SELECT user_id FROM user_access WHERE user_id = $1 AND status <> 'active'",job.user_id)) continue;
        {
          const current = await db().one("SELECT COALESCE(MAX(level),0) AS level FROM referral_purchases WHERE user_id = $1", job.user_id);
          if (current!.level >= job.level) {
            await db().execute("UPDATE referral_auto_upgrades SET status = 'superseded',last_error = NULL WHERE cycle_id = $1", job.cycle_id);
            continue;
          }
          await buyReferralLevel(job.user_id, job.level, `referral-auto:${job.cycle_id}`);
          await db().execute("UPDATE referral_auto_upgrades SET status = 'completed',last_error = NULL WHERE cycle_id = $1", job.cycle_id);
        }
      } catch {
        await db().execute("UPDATE referral_auto_upgrades SET last_error = 'Waiting for enough available wallet credit for the next level.' WHERE cycle_id = $1 AND status = 'queued'", job.cycle_id);
      }
    }
  } finally { upgrading = false; }
}
