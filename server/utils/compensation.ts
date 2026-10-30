import { completeRebirth, rebirthRecipients, referralRecipients, unlockMatrixLevel, type ReferralJob } from "./matrix";
import { createError } from "h3";
import { ledgerScale, levelPrice, maxReferralLevel, purchaseShares, shareRecipientIndex } from "../../shared/compensation";
import { db, transaction } from "./database";
import { randomUUID } from "./auth";
import { walletRow } from "./wallet";
import { referralPaymentMode } from "./referral-chain";
import { requireEmbeddedWalletMode } from "./wallet-mode";
import { paidReferralCount } from "./commission-qualification";
import { queuedReferralJobs } from "./referral-auto-retry";


export async function buyReferralLevel(userId: string, level: number, requestKey: string, rebirth?: ReferralJob) {
  requireEmbeddedWalletMode();
  if (referralPaymentMode() !== "ledger")
    throw createError({ statusCode: 409, statusMessage: "Use the smart contract purchase flow to pay from your Amoy wallet." });
  if (!Number.isInteger(level) || level < 1 || level > maxReferralLevel)
    throw createError({ statusCode: 400, statusMessage: "Choose a referral level between 1 and 15." });
  return transaction(async () => {
    // Share the genealogy lock with sponsor changes, then lock ALL affected wallets
    // in transfer order. This prevents graph races and opposite wallet deadlocks.
    await db().execute("SELECT pg_advisory_xact_lock(782438, 2)");
    if (rebirth) {
      const job = await db().one<ReferralJob & { status: string }>("SELECT * FROM referral_auto_upgrades WHERE cycle_id=$1 FOR UPDATE",rebirth.cycle_id);
      if (!job || job.kind !== 'rebirth' || job.user_id !== userId || job.level !== level)
        throw createError({ statusCode: 409, statusMessage: "Invalid rebirth payment." });
      if (job.status === 'completed') return;
      rebirth = job;
    }
    const activation = await db().one("SELECT user_id FROM referral_activations WHERE user_id = $1", userId);
    if (!rebirth && level === 1 && activation) return;
    const previous = await db().one(`SELECT p.level FROM referral_purchases p JOIN wallet_transactions t ON t.id = p.transaction_id
      WHERE p.user_id = $1 AND t.request_key = $2`, userId, requestKey);
    if (previous) {
      if (previous.level !== level) throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
      return;
    }
    const current = await db().one("SELECT COALESCE(MAX(level), $2::INTEGER) AS level FROM referral_purchases WHERE user_id = $1", userId, activation ? 1 : 0);
    if (!rebirth && level !== current!.level + 1)
      throw createError({ statusCode: 409, statusMessage: "Purchase the next referral level in order. The maximum is level 15." });
    const settings = await db().one("SELECT fee_recipient_address FROM platform_settings WHERE id = 1 FOR SHARE") as { fee_recipient_address: string };
    if (!settings.fee_recipient_address)
      throw createError({ statusCode: 409, statusMessage: "Referral purchases are unavailable until an administrator sets the platform fee address." });
    const recipients = rebirth ? await rebirthRecipients(rebirth,"ledger") : await referralRecipients(userId, level, "ledger");
    const sponsor = !rebirth && level===1 ? await db().one<{sponsor_id: string | null}>("SELECT sponsor_id FROM users WHERE id=$1",userId) : null;
    await db().all("SELECT id FROM wallets WHERE user_id = ANY($1::TEXT[]) ORDER BY id FOR UPDATE", [userId, ...recipients.flatMap(item => item.userId ? [item.userId] : []),...(sponsor?.sponsor_id ? [sponsor.sponsor_id] : [])]);
    const wallet = await walletRow(userId);
    const price = levelPrice(level) * ledgerScale;
    if (wallet.available < price)
      throw createError({ statusCode: 400, statusMessage: "Your available USDT credit balance is too low for this referral purchase." });
    if (await db().one("SELECT id FROM wallet_transactions WHERE wallet_id = $1 AND request_key = $2", wallet.id, requestKey))
      throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
    const id = randomUUID(), transactionId = randomUUID(), timestamp = new Date().toISOString();
    await db().execute("UPDATE wallets SET available = available - $1 WHERE id = $2", price, wallet.id);
    await db().execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'referral_purchase', $3, 'completed', $4, $5, $6)",
      transactionId, wallet.id, price, rebirth ? `Referral ${rebirth.source} rebirth ${rebirth.rebirth_cycle} · level ${level}` : level === 1 ? "Referral activation" : `Referral level ${level} purchase`, requestKey, timestamp);
    await db().execute(`INSERT INTO referral_purchases (id, user_id, level, amount, transaction_id, fee_recipient_address, created_at, rebirth_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, id, userId, level, price, transactionId, settings.fee_recipient_address, timestamp,rebirth?.cycle_id ?? null);
    if (!rebirth && level === 1) {
      await db().execute("INSERT INTO referral_activations (user_id, transaction_id, created_at) VALUES ($1, $2, $3)", userId, transactionId, timestamp);
    }
    const qualified = new Set<string>();
    for(const member of new Set([...recipients.flatMap(row=>row.userId ? [row.userId] : []),...(sponsor?.sponsor_id ? [sponsor.sponsor_id] : [])])) {
      if (await paidReferralCount(member)>=2) {
        qualified.add(member);
        await releaseHeldLedgerCommissions(member,timestamp);
      }
    }
    for (const share of purchaseShares(level)) {
      const position = shareRecipientIndex(share);
      const upline = position >= 0 ? recipients[position]! : null;
      const recipient = upline?.userId ? upline : null;
      const held = recipient !== null && !qualified.has(recipient.userId!);
      const creditId = recipient && !held ? randomUUID() : null;
      if (recipient && !held) {
        await db().execute("UPDATE wallets SET available = available + $1 WHERE id = $2", share.units, recipient.address);
        await db().execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'commission', $3, 'completed', $4, $5, $6)",
          creditId, recipient.address, share.units, `Referral ${share.kind} commission · level ${level} · upline ${share.depth}`,
          `referral:${id}:${share.kind}:${share.depth}`, timestamp);
      }
      await db().execute(`INSERT INTO referral_allocations
        (id, purchase_id, kind, depth, amount, recipient_user_id, recipient_address, transaction_id, status, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        randomUUID(), id, share.kind, share.depth, share.units, recipient?.userId ?? null,
        recipient ? null : settings.fee_recipient_address, creditId, held ? "held" : recipient ? "credited" : "payable",
        share.kind === "platform" ? "platform_fee" : recipient ? "upline" : upline?.reason ?? "missing_upline");
    }
    if (rebirth) await completeRebirth(rebirth);
    else await unlockMatrixLevel(userId, level);
  });
}

// Called with the genealogy lock and the recipient wallet already locked.
export async function releaseHeldLedgerCommissions(userId: string, timestamp: string) {
  const held = await db().all<{id:string;amount:number}>("SELECT id,amount FROM referral_allocations WHERE recipient_user_id=$1 AND status='held' ORDER BY id FOR UPDATE",userId);
  if (!held.length) return;
  const wallet = await walletRow(userId,true);
  for(const allocation of held) {
    const creditId=randomUUID();
    await db().execute("UPDATE wallets SET available=available+$1 WHERE id=$2",allocation.amount,wallet.id);
    await db().execute("INSERT INTO wallet_transactions VALUES($1,$2,'commission',$3,'completed',$4,$5,$6)",creditId,wallet.id,allocation.amount,
      "Held commission released after two paid direct referrals",`referral-release:${allocation.id}`,timestamp);
    await db().execute("UPDATE referral_allocations SET status='credited',transaction_id=$1 WHERE id=$2 AND status='held'",creditId,allocation.id);
  }
}

let upgrading = false;
export async function processLedgerReferralUpgrades() {
  if (upgrading || referralPaymentMode() !== "ledger") return;
  upgrading = true;
  try {
    const jobs = await queuedReferralJobs();
    for (const job of jobs) {
      await db().execute("UPDATE referral_auto_upgrades SET last_attempt_at = $1 WHERE cycle_id = $2", new Date().toISOString(),job.cycle_id);
      try {
        if (await db().one("SELECT user_id FROM user_access WHERE user_id = $1 AND status <> 'active'",job.user_id)) continue;
        {
          if (job.kind === 'rebirth') {
            await buyReferralLevel(job.user_id,job.level,`referral-auto:${job.cycle_id}`,job);
            continue;
          }
          if (await db().one("SELECT cycle_id FROM referral_auto_upgrades WHERE cycle_id=$1 AND status<>'completed'",`rebirth:${job.cycle_id}`)) continue;
          const current = await db().one("SELECT COALESCE(MAX(level),0) AS level FROM referral_purchases WHERE user_id = $1", job.user_id);
          if (current!.level >= job.level) {
            await db().execute("UPDATE referral_auto_upgrades SET status = 'superseded',last_error = NULL WHERE cycle_id = $1", job.cycle_id);
            continue;
          }
          await buyReferralLevel(job.user_id, job.level, `referral-auto:${job.cycle_id}`);
          await db().execute("UPDATE referral_auto_upgrades SET status = 'completed',last_error = NULL WHERE cycle_id = $1", job.cycle_id);
        }
      } catch {
        await db().execute("UPDATE referral_auto_upgrades SET last_error = $2 WHERE cycle_id = $1 AND status = 'queued'", job.cycle_id,
          job.kind === 'rebirth' ? 'Waiting for enough available wallet credit for the rebirth.' : 'Waiting for enough available wallet credit for the next level.');
      }
    }
  } finally { upgrading = false; }
}
