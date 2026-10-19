import type { H3Event } from "h3";
import { getAddress, isAddress } from "ethers";
import type { PlatformActivity, PlatformAnalytics, PlatformTransaction } from "../../shared/platform-activity";
import { db } from "./database";
import { moneyScale } from "./wallet";

export function platformContract() {
  const address = useRuntimeConfig().referral.contractAddress;
  return address && isAddress(address) ? getAddress(address) : null;
}

// Only public transaction evidence is selected. Quotes, signed bytes, account IDs,
// private ledger records and operation payloads never enter an API response.
const transactions = `WITH evidence AS (
  SELECT lower(transaction_hash) AS hash, 'purchase' AS kind, status,
    buyer_address AS sender, contract_address AS target, NULL::text AS recipient,
    level, amount, block_number, created_at
  FROM referral_chain_purchases
  WHERE lower(contract_address) = lower($1) AND transaction_hash IS NOT NULL AND status <> 'awaiting_signature'
  UNION ALL
  SELECT lower(transaction_hash), 'fee_update', status, owner_address, contract_address,
    recipient_address, NULL::integer, 0::bigint, NULL::bigint, created_at
  FROM referral_chain_fee_updates WHERE lower(contract_address) = lower($1)
  UNION ALL
  SELECT lower(transaction_hash), 'fee_update', status, payload->'call'->>'from', payload->>'contract',
    payload->>'recipient', NULL::integer, 0::bigint, NULL::bigint, created_at
  FROM external_wallet_operations WHERE kind = 'fee' AND lower(payload->>'contract') = lower($1)
    AND transaction_hash IS NOT NULL AND status <> 'awaiting_signature'
), activity AS (
  SELECT DISTINCT ON (hash) * FROM evidence ORDER BY hash, kind
)`;

export async function platformActivity(event: H3Event): Promise<PlatformActivity> {
  const query = getQuery(event);
  const state = String(query.status || "all"), kind = String(query.kind || "all"), period = String(query.period || "all");
  if (!["all", "pending", "confirmed", "failed"].includes(state) || !["all", "purchase", "fee_update"].includes(kind) || !["all", "7", "30", "90"].includes(period))
    throw createError({ statusCode: 400, statusMessage: "Choose valid explorer filters." });
  const page = Math.max(1, Math.min(100000, Number.parseInt(String(query.page || 1), 10) || 1));
  const contractAddress = platformContract();
  const base: PlatformActivity = { configured: !!contractAddress, contractAddress, chainId: 80002, items: [], total: 0, page, pageSize: 12,
    summary: { confirmed: 0, pending: 0, failed: 0, volume: 0 } };
  if (!contractAddress) return base;
  const since = period === "all" ? "" : new Date(Date.now() - Number(period) * 86400000).toISOString();
  const search = String(query.search || "").trim().slice(0, 100).toLowerCase();
  const where = `WHERE ($2 = 'all' OR status = $2) AND ($3 = 'all' OR kind = $3) AND created_at >= $4
    AND (strpos(lower(hash), $5) > 0 OR strpos(lower(sender), $5) > 0 OR strpos(lower(target), $5) > 0 OR strpos(lower(COALESCE(recipient,'')), $5) > 0)`;
  const args = [contractAddress, state, kind, since, search];
  const totals = await db().one(`${transactions} SELECT COUNT(*) AS total,
    COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
    COALESCE(SUM(amount) FILTER (WHERE status = 'confirmed' AND kind = 'purchase'),0) AS volume FROM activity ${where}`, ...args);
  const rows = await db().all<Omit<PlatformTransaction, "explorerUrl">>(`${transactions}
    SELECT hash, kind, status, sender AS "from", target AS "to", recipient, level, amount,
      block_number AS "blockNumber", created_at AS "createdAt" FROM activity ${where}
    ORDER BY created_at DESC, hash DESC LIMIT 12 OFFSET $6`, ...args, (page - 1) * 12);
  return { ...base, total: totals!.total, summary: { confirmed: totals!.confirmed, pending: totals!.pending, failed: totals!.failed, volume: totals!.volume / moneyScale },
    items: rows.map(row => ({ ...row, amount: row.amount / moneyScale, explorerUrl: `https://amoy.polygonscan.com/tx/${row.hash}` })) };
}

export async function platformAnalytics(): Promise<PlatformAnalytics> {
  const contractAddress = platformContract();
  const result = await db().transaction(async () => {
    await db().execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const accounts = await db().one(`SELECT COUNT(*) AS accounts,
      COUNT(*) FILTER (WHERE COALESCE(a.status,'active') = 'active' AND COALESCE(a.role,'member') = 'member') AS active
      FROM users u LEFT JOIN user_access a ON a.user_id = u.id`);
    const paid = await db().one(`SELECT COUNT(*) AS purchases, COUNT(DISTINCT lower(buyer_address)) AS buyers, COALESCE(SUM(amount),0) AS volume
      FROM referral_chain_purchases WHERE lower(contract_address) = lower($1) AND status = 'confirmed'`, contractAddress);
    const count = await db().one(`${transactions} SELECT COUNT(*) AS total FROM activity WHERE status = 'confirmed'`, contractAddress);
    const shares = await db().one(`SELECT
      COALESCE(SUM(a.amount) FILTER (WHERE a.kind = 'direct'),0) AS direct,
      COALESCE(SUM(a.amount) FILTER (WHERE a.kind = 'bonus'),0) AS bonus,
      COALESCE(SUM(a.amount) FILTER (WHERE a.kind = 'platform'),0) AS platform
      FROM referral_chain_allocations a JOIN referral_chain_purchases p ON p.id = a.purchase_id
      WHERE lower(p.contract_address) = lower($1) AND p.status = 'confirmed'`, contractAddress);
    const daily = await db().all<{ day: string; accounts: number; purchases: number; volume: number }>(`
      WITH days AS (SELECT generate_series(
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date - 29,
        (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date, '1 day')::date AS day),
      registrations AS (SELECT (created_at::timestamptz AT TIME ZONE 'Asia/Bangkok')::date AS day, COUNT(*) AS total FROM users GROUP BY 1),
      purchases AS (SELECT (created_at::timestamptz AT TIME ZONE 'Asia/Bangkok')::date AS day,
        COUNT(*) AS total, SUM(amount) AS volume FROM referral_chain_purchases
        WHERE lower(contract_address) = lower($1) AND status = 'confirmed' GROUP BY 1)
      SELECT to_char(d.day,'YYYY-MM-DD') AS day, COALESCE(r.total,0) AS accounts, COALESCE(p.total,0) AS purchases,
        COALESCE(p.volume,0) AS volume FROM days d LEFT JOIN registrations r USING(day) LEFT JOIN purchases p USING(day) ORDER BY d.day`, contractAddress);
    const levels = await db().all<{ level: number; purchases: number; volume: number }>(`
      SELECT l.level, COUNT(p.id) AS purchases, COALESCE(SUM(p.amount),0) AS volume
      FROM generate_series(1,15) AS l(level) LEFT JOIN referral_chain_purchases p ON p.level = l.level
        AND lower(p.contract_address) = lower($1) AND p.status = 'confirmed' GROUP BY l.level ORDER BY l.level`, contractAddress);
    return { accounts: accounts!.accounts, activeMembers: accounts!.active, buyers: paid!.buyers, purchases: paid!.purchases,
      transactions: count!.total, volume: paid!.volume / moneyScale,
      distributions: { direct: shares!.direct / moneyScale, bonus: shares!.bonus / moneyScale, platform: shares!.platform / moneyScale },
      daily: daily.map(row => ({ ...row, volume: row.volume / moneyScale })), levels: levels.map(row => ({ ...row, volume: row.volume / moneyScale })) };
  });
  return { ...result, configured: !!contractAddress, contractAddress, chainId: 80002, updatedAt: new Date().toISOString() };
}
