import { requireAdmin } from "../../utils/auth";
import { db } from "../../utils/database";
import { adminReferralPurchaseFields, listQuery } from "../../utils/admin";
import { moneyScale } from "../../utils/wallet";
import type { AdminList, AdminMember } from "../../../shared/admin";
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const { page, pageSize, search, status } = listQuery(event);
    const where = `WHERE (strpos(COALESCE(u.referral_code, ''), $1) > 0 OR strpos(u.id, $1) > 0) AND ($2 = 'all' OR COALESCE(a.status, 'active') = $3)`;
    const from = `FROM users u LEFT JOIN user_access a ON a.user_id = u.id`;
    const total = (await db().one(`SELECT COUNT(*) AS total ${from} ${where}`, search, status, status) as {
        total: number;
    }).total;
    const items = await db().all(`SELECT u.id, COALESCE(u.referral_code, '') AS "memberId", COALESCE(a.role, 'member') AS role, COALESCE(a.status, 'active') AS status,
    CASE WHEN r.user_id IS NOT NULL THEN u.referral_code END AS "referralCode", s.referral_code AS sponsor, u.created_at AS "createdAt", COALESCE(w.available, 0) AS balance,
    (SELECT COUNT(*) FROM users child WHERE child.sponsor_id = u.id) AS referrals,
    ${adminReferralPurchaseFields} ${from}
    LEFT JOIN users s ON s.id = u.sponsor_id LEFT JOIN wallets w ON w.user_id = u.id
    LEFT JOIN referral_activations r ON r.user_id = u.id ${where}
    ORDER BY u.created_at DESC, u.id DESC LIMIT $4 OFFSET $5`, search, status, status, pageSize, (page - 1) * pageSize) as unknown as AdminMember[];
    return { items: items.map(item => ({ ...item, balance: item.balance / moneyScale })), total, page, pageSize } satisfies AdminList<AdminMember>;
});
