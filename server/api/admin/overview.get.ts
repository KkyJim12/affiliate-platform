import { requireAdmin } from "../../utils/auth";
import { db } from "../../utils/database";
import { paymentRows, paymentSelect } from "../../utils/admin";
import { moneyScale } from "../../utils/wallet";
import type { AdminOverview } from "../../../shared/admin";
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const users = await db().one(`SELECT COUNT(*) AS total, SUM(CASE WHEN COALESCE(a.status, 'active') = 'active' THEN 1 ELSE 0 END) AS active FROM users u LEFT JOIN user_access a ON a.user_id = u.id`) as {
        total: number;
        active: number;
    };
    const pending = await db().one(`SELECT COUNT(*) AS count, COALESCE(SUM(t.amount), 0) AS amount FROM wallet_transactions t LEFT JOIN payment_reviews r ON r.transaction_id = t.id WHERE t.type = 'deposit' AND t.status = 'pending' AND r.transaction_id IS NULL`) as {
        count: number;
        amount: number;
    };
    const balance = await db().one("SELECT COALESCE(SUM(available), 0) AS amount FROM wallets") as {
        amount: number;
    };
    const settled = await db().one("SELECT COALESCE(SUM(amount), 0) AS amount FROM wallet_transactions WHERE type = 'deposit' AND status = 'completed'") as {
        amount: number;
    };
    const growth = await Promise.all(Array.from({ length: 7 }, async (_, index) => {
        const day = new Date(Date.now() - (6 - index) * 86400000).toISOString().slice(0, 10);
        return { day, accounts: (await db().one("SELECT COUNT(*) AS total FROM users WHERE substr(created_at, 1, 10) = $1", day) as {
                total: number;
            }).total };
    }));
    return {
        accounts: users.total, active: users.active || 0, pendingCount: pending.count, pendingAmount: pending.amount / moneyScale,
        walletBalance: balance.amount / moneyScale, settledAmount: settled.amount / moneyScale, growth,
        payments: paymentRows(await db().all(`${paymentSelect} WHERE t.type = 'deposit' ORDER BY t.created_at DESC, t.sequence DESC LIMIT 5`)),
        audit: await db().all(`SELECT a.id, u.referral_code AS "memberId", a.action,
          CASE WHEN a.action = 'user_username_changed' THEN '---'
            WHEN a.action IN ('admin_created','user_suspended','user_activated','payment_approved','payment_rejected') THEN
              COALESCE((SELECT 'ID ' || target.referral_code FROM users target
                WHERE target.id = a.target OR target.referral_code = regexp_replace(a.target, '^ID ', '') OR target.username = a.target LIMIT 1), '---')
            ELSE a.target END AS target,
          a.created_at AS "createdAt" FROM admin_audit a JOIN users u ON u.id = a.admin_id
          ORDER BY a.created_at DESC, a.id DESC LIMIT 8`),
    } as AdminOverview;
});
