import { requireUser } from "../utils/auth";
import { db } from "../utils/database";
import { moneyScale } from "../utils/wallet";
import type { DashboardSummary } from "../../shared/dashboard";

export default defineEventHandler((event): DashboardSummary => {
  const user = requireUser(event);
  const ledger = db().prepare(`SELECT
    COALESCE(SUM(CASE WHEN t.type = 'commission' AND t.status = 'completed' THEN t.amount ELSE 0 END), 0) AS commissions,
    COALESCE(SUM(CASE WHEN t.type = 'deposit' AND t.status = 'pending' AND r.transaction_id IS NULL THEN t.amount ELSE 0 END), 0) AS pending,
    COALESCE(SUM(CASE WHEN t.type IN ('transfer_in', 'transfer_out') AND t.status = 'completed' THEN 1 ELSE 0 END), 0) AS transfers
    FROM wallets w JOIN wallet_transactions t ON t.wallet_id = w.id
    LEFT JOIN payment_reviews r ON r.transaction_id = t.id WHERE w.user_id = ?`).get(user.id) as { commissions: number; pending: number; transfers: number };
  const network = db().prepare(`WITH RECURSIVE descendants AS (
    SELECT id, 1 AS depth FROM users WHERE sponsor_id = ?
    UNION ALL SELECT u.id, p.depth + 1 FROM users u JOIN descendants p ON u.sponsor_id = p.id WHERE p.depth < 15 LIMIT 501
  ) SELECT COUNT(*) AS total, COALESCE(MAX(depth), 0) AS depth FROM descendants`).get(user.id) as { total: number; depth: number };
  const direct = (db().prepare("SELECT COUNT(*) AS total FROM users WHERE sponsor_id = ?").get(user.id) as { total: number }).total;
  return { commissions: ledger.commissions / moneyScale, pendingFunding: ledger.pending / moneyScale, completedTransfers: ledger.transfers,
    referrals: { direct, total: Math.min(network.total, 500), depth: network.depth, truncated: network.total > 500 } };
});
