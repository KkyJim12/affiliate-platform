import type { H3Event } from "h3";
import type { ExplorerActivity, ExplorerNetwork, ExplorerTransaction } from "../../shared/explorer";
import type { UserRow } from "./auth";
import { db } from "./database";
import { moneyScale, ledgerDescriptionSql } from "./wallet";
import { isMemberId } from "../../shared/referral-code";
export async function networkFor(event: H3Event, actor: UserRow, admin = false): Promise<ExplorerNetwork> {
    const query = getQuery(event);
    const rootId = typeof query.root === "string" ? query.root.slice(0, 64) : "";
    const memberId = typeof query.memberId === "string" ? query.memberId.trim() : "";
    if (query.memberId !== undefined && !isMemberId(memberId))
        throw createError({ statusCode: 400, statusMessage: "Enter a valid numeric member ID." });
    const root = await db().one(`SELECT id, COALESCE(referral_code, '') AS "memberId", created_at AS "joinedAt" FROM users WHERE ${rootId ? "id = $1" : memberId ? "referral_code = $1" : "id = $1"}`, rootId || memberId || actor.id) as ExplorerNetwork["root"] | undefined;
    // Use the same response for missing accounts and accounts outside this member's network.
    if (!root)
        throw createError({ statusCode: 404, statusMessage: "This network is unavailable." });
    let remainingDepth = 15;
    if (!admin && root.id !== actor.id) {
        const ancestor = await db().one(`WITH RECURSIVE ancestors AS (
      SELECT id, sponsor_id, 0 AS depth FROM users WHERE id = $1
      UNION ALL SELECT u.id, u.sponsor_id, a.depth + 1 FROM users u JOIN ancestors a ON u.id = a.sponsor_id WHERE a.depth < 15
    ) SELECT depth FROM ancestors WHERE id = $2`, root.id, actor.id) as {
            depth: number;
        } | undefined;
        if (!ancestor)
            throw createError({ statusCode: 404, statusMessage: "This network is unavailable." });
        remainingDepth -= ancestor.depth;
    }
    const rows = await db().all(`WITH RECURSIVE descendants AS (
    SELECT id, referral_code, sponsor_id, created_at, 1 AS depth FROM users WHERE sponsor_id = $1 AND $2 > 0
    UNION ALL SELECT u.id, u.referral_code, u.sponsor_id, u.created_at, p.depth + 1
    FROM users u JOIN descendants p ON u.sponsor_id = p.id WHERE p.depth < $3
  ), limited AS (SELECT * FROM descendants LIMIT 501)
  SELECT id, COALESCE(referral_code, '') AS "memberId", sponsor_id AS "parentId", created_at AS "joinedAt", depth FROM limited ORDER BY depth, created_at, id`, root.id, remainingDepth, remainingDepth) as unknown as Omit<ExplorerNetwork["members"][number], "status">[];
    return { root, members: rows.slice(0, 500).map(row => ({ ...row, status: "Registered" })), truncated: rows.length > 500, remainingDepth };
}
export async function activityFor(event: H3Event, actor: UserRow, admin = false): Promise<ExplorerActivity> {
    const query = getQuery(event);
    const search = typeof query.search === "string" ? query.search.trim().slice(0, 100) : "";
    const status = String(query.status || "all");
    const type = String(query.type || "all");
    const period = String(query.period || "all");
    if (!["all", "pending", "completed", "rejected"].includes(status) || !["all", "deposit", "withdrawal", "transfer_in", "transfer_out", "commission", "referral_purchase"].includes(type) || !["all", "7", "30", "90"].includes(period))
        throw createError({ statusCode: 400, statusMessage: "Choose valid explorer filters." });
    const page = Math.max(1, Math.min(100000, Number.parseInt(String(query.page || 1), 10) || 1));
    const pageSize = 12;
    const from = `FROM wallet_transactions t JOIN wallets w ON w.id = t.wallet_id JOIN users u ON u.id = w.user_id LEFT JOIN payment_reviews r ON r.transaction_id = t.id`;
    const displayStatus = `CASE WHEN r.decision = 'rejected' THEN 'rejected' ELSE t.status END`;
    const where = `WHERE ($1 = 1 OR w.user_id = $2) AND ($3 = 'all' OR ${displayStatus} = $4) AND ($5 = 'all' OR t.type = $6)
    AND t.created_at >= $7 AND (strpos(lower(t.id), lower($8)) > 0 OR strpos(lower(${ledgerDescriptionSql}), lower($9)) > 0 OR strpos(u.referral_code, $10) > 0 OR strpos(lower(COALESCE(r.reference, '')), lower($11)) > 0)`;
    const since = period === "all" ? "" : new Date(Date.now() - Number(period) * 86400000).toISOString();
    const args = [Number(admin), actor.id, status, status, type, type, since, search, search, search, search];
    const summary = await db().one(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN t.status = 'completed' AND t.type IN ('deposit', 'transfer_in', 'commission') THEN t.amount ELSE 0 END), 0) AS credits,
    COALESCE(SUM(CASE WHEN t.status = 'completed' AND t.type IN ('withdrawal', 'transfer_out', 'referral_purchase') THEN t.amount ELSE 0 END), 0) AS debits,
    COALESCE(SUM(CASE WHEN ${displayStatus} = 'pending' THEN t.amount ELSE 0 END), 0) AS pending ${from} ${where}`, ...args) as {
        total: number;
        credits: number;
        debits: number;
        pending: number;
    };
    const rows = await db().all(`SELECT t.id, COALESCE(u.referral_code, '') AS "memberId", w.id AS "walletId", t.type, t.amount, ${displayStatus} AS status,
    ${ledgerDescriptionSql} AS description, t.created_at AS "createdAt", r.reference, r.note, r.created_at AS "reviewedAt" ${from} ${where}
    ORDER BY t.created_at DESC, t.sequence DESC LIMIT $12 OFFSET $13`, ...args, pageSize, (page - 1) * pageSize) as unknown as ExplorerTransaction[];
    return { items: rows.map(row => ({ ...row, amount: row.amount / moneyScale })), total: summary.total, page, pageSize,
        summary: { credits: summary.credits / moneyScale, debits: summary.debits / moneyScale, pending: summary.pending / moneyScale } };
}
