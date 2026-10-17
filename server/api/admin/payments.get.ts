import { requireAdmin } from "../../utils/auth";
import { db } from "../../utils/database";
import { listQuery, paymentRows, paymentSelect } from "../../utils/admin";
export default defineEventHandler(async (event) => {
    await requireAdmin(event);
    const { page, pageSize, search, status } = listQuery(event);
    const condition = `t.type = 'deposit' AND (strpos(lower(u.username), lower($1)) > 0 OR strpos(lower(COALESCE(r.reference, '')), lower($2)) > 0) AND ($3 = 'all' OR (CASE WHEN r.decision = 'rejected' THEN 'rejected' ELSE t.status END) = $4)`;
    const args = [search, search, status, status];
    const total = (await db().one(`SELECT COUNT(*) AS total FROM (${paymentSelect} WHERE ${condition}) AS payments`, ...args) as {
        total: number;
    }).total;
    return { items: paymentRows(await db().all(`${paymentSelect} WHERE ${condition} ORDER BY t.created_at DESC, t.sequence DESC LIMIT $5 OFFSET $6`, ...args, pageSize, (page - 1) * pageSize)), total, page, pageSize };
});
