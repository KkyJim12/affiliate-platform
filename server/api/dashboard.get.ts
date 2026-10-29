import { requireUser } from "../utils/auth";
import { db } from "../utils/database";
import { moneyScale } from "../utils/wallet";
import type { DashboardSummary } from "../../shared/dashboard";
export default defineEventHandler(async (event): Promise<DashboardSummary> => {
    const user = await requireUser(event);
    const ledger = await db().one(`SELECT
    COALESCE(SUM(CASE WHEN t.type = 'commission' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS commissions,
    COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.status = 'pending' AND r.transaction_id IS NULL THEN t.amount ELSE 0 END), 0) AS pending,
    COALESCE(SUM(CASE WHEN t.type IN ('transfer_in', 'transfer_out') AND t.status = 'completed' THEN 1 ELSE 0 END), 0) AS transfers
    FROM wallets w JOIN wallet_transactions t ON t.wallet_id = w.id
    LEFT JOIN payment_reviews r ON r.transaction_id = t.id WHERE w.user_id = $1`, user.id) as {
        commissions: number;
        pending: number;
        transfers: number;
    };
    const network = await db().one(`WITH RECURSIVE descendants AS (
    SELECT id, 1 AS depth FROM users WHERE sponsor_id = $1
    UNION ALL SELECT u.id, p.depth + 1 FROM users u JOIN descendants p ON u.sponsor_id = p.id WHERE p.depth < 15
  ) SELECT COUNT(*) AS total, COALESCE(MAX(depth), 0) AS depth FROM (SELECT * FROM descendants LIMIT 501) AS limited`, user.id) as {
        total: number;
        depth: number;
    };
    const direct = (await db().one("SELECT COUNT(*) AS total FROM users WHERE sponsor_id = $1", user.id) as {
        total: number;
    }).total;
    const breakdown = await db().one(`SELECT
      COALESCE(SUM(CASE WHEN kind = 'direct' THEN amount ELSE 0 END), 0) AS direct,
      COALESCE(SUM(CASE WHEN kind = 'bonus' THEN amount ELSE 0 END), 0) AS bonus
      FROM referral_allocations WHERE recipient_user_id = $1 AND status = 'credited'`, user.id);
    const onchain = await db().one(`SELECT COALESCE(SUM(amount),0) AS total,
      COALESCE(SUM(CASE WHEN kind = 'direct' THEN amount ELSE 0 END),0) AS direct,
      COALESCE(SUM(CASE WHEN kind = 'bonus' THEN amount ELSE 0 END),0) AS bonus
      FROM referral_chain_allocations WHERE recipient_user_id = $1 AND status='credited'`, user.id);
    return { commissions: (ledger.commissions + onchain!.total) / moneyScale, directCommissions: (breakdown!.direct + onchain!.direct) / moneyScale,
        bonusCommissions: (breakdown!.bonus + onchain!.bonus) / moneyScale, pendingFunding: ledger.pending / moneyScale, completedTransfers: ledger.transfers,
        referrals: { direct, total: Math.min(network.total, 500), depth: network.depth, truncated: network.total > 500 } };
});
