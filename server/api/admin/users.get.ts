import { requireAdmin } from "../../utils/auth";
import { db } from "../../utils/database";
import { listQuery } from "../../utils/admin";
import { moneyScale } from "../../utils/wallet";
import type { AdminList, AdminMember } from "../../../shared/admin";

export default defineEventHandler(event => {
  requireAdmin(event);
  const { page, pageSize, search, status } = listQuery(event);
  const where = `WHERE instr(lower(u.username), lower(?)) > 0 AND (? = 'all' OR COALESCE(a.status, 'active') = ?)`;
  const from = `FROM users u LEFT JOIN user_access a ON a.user_id = u.id`;
  const total = (db().prepare(`SELECT COUNT(*) AS total ${from} ${where}`).get(search, status, status) as { total: number }).total;
  const items = db().prepare(`SELECT u.id, u.username, COALESCE(a.role, 'member') AS role, COALESCE(a.status, 'active') AS status,
    CASE WHEN r.user_id IS NOT NULL THEN u.referral_code END AS referralCode, s.username AS sponsor, u.created_at AS createdAt, COALESCE(w.available, 0) AS balance,
    (SELECT COUNT(*) FROM users child WHERE child.sponsor_id = u.id) AS referrals ${from}
    LEFT JOIN users s ON s.id = u.sponsor_id LEFT JOIN wallets w ON w.user_id = u.id
    LEFT JOIN referral_activations r ON r.user_id = u.id ${where}
    ORDER BY u.created_at DESC, u.rowid DESC LIMIT ? OFFSET ?`).all(search, status, status, pageSize, (page - 1) * pageSize) as unknown as AdminMember[];
  return { items: items.map(item => ({ ...item, balance: item.balance / moneyScale })), total, page, pageSize } satisfies AdminList<AdminMember>;
});
