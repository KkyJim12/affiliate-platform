import { requireAdmin } from "../../utils/auth";
import { db } from "../../utils/database";
import { paymentRows, paymentSelect } from "../../utils/admin";
import { moneyScale } from "../../utils/wallet";
import type { AdminOverview } from "../../../shared/admin";

export default defineEventHandler(event => {
  requireAdmin(event);
  const users = db().prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(a.status, 'active') = 'active' THEN 1 ELSE 0 END) AS active FROM users u LEFT JOIN user_access a ON a.user_id = u.id`).get() as { total: number; active: number };
  const pending = db().prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS amount FROM wallet_transactions t LEFT JOIN payment_reviews r ON r.transaction_id = t.id WHERE t.type = 'deposit' AND t.status = 'pending' AND r.transaction_id IS NULL`).get() as { count: number; amount: number };
  const balance = db().prepare("SELECT COALESCE(SUM(available), 0) AS amount FROM wallets").get() as { amount: number };
  const settled = db().prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM wallet_transactions WHERE type = 'deposit' AND status = 'completed'").get() as { amount: number };
  const growth = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(Date.now() - (6 - index) * 86400000).toISOString().slice(0, 10);
    return { day, accounts: (db().prepare("SELECT COUNT(*) AS total FROM users WHERE substr(created_at, 1, 10) = ?").get(day) as { total: number }).total };
  });
  return {
    accounts: users.total, active: users.active || 0, pendingCount: pending.count, pendingAmount: pending.amount / moneyScale,
    walletBalance: balance.amount / moneyScale, settledAmount: settled.amount / moneyScale, growth,
    payments: paymentRows(db().prepare(`${paymentSelect} WHERE t.type = 'deposit' ORDER BY t.created_at DESC, t.rowid DESC LIMIT 5`).all()),
    audit: db().prepare("SELECT a.id, u.username, a.action, a.target, a.created_at AS createdAt FROM admin_audit a JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC, a.rowid DESC LIMIT 8").all(),
  } as AdminOverview;
});
