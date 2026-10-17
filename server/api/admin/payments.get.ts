import { requireAdmin } from "../../utils/auth";
import { db } from "../../utils/database";
import { listQuery, paymentRows, paymentSelect } from "../../utils/admin";

export default defineEventHandler(event => {
  requireAdmin(event);
  const { page, pageSize, search, status } = listQuery(event);
  const condition = `t.type = 'deposit' AND (instr(lower(u.username), lower(?)) > 0 OR instr(lower(COALESCE(r.reference, '')), lower(?)) > 0) AND (? = 'all' OR (CASE WHEN r.decision = 'rejected' THEN 'rejected' ELSE t.status END) = ?)`;
  const args = [search, search, status, status];
  const total = (db().prepare(`SELECT COUNT(*) AS total FROM (${paymentSelect} WHERE ${condition})`).get(...args) as { total: number }).total;
  return { items: paymentRows(db().prepare(`${paymentSelect} WHERE ${condition} ORDER BY t.created_at DESC, t.rowid DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize)), total, page, pageSize };
});
