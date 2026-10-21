import { isMemberId } from "../../../shared/referral-code";
import { referralTreeDepth, treePathSlots, type ReferralTreeData } from "../../../shared/referral-tree";
import { db } from "../../utils/database";

// Deliberately public: only numeric IDs, usernames and invitation links leave
// this endpoint. Internal UUIDs, wallets, balances and account details stay private.
export default defineEventHandler(async (event): Promise<ReferralTreeData> => {
  const query = getQuery(event);
  const id = typeof query.id === "string" ? query.id.trim() : "";
  const path = typeof query.path === "string" ? query.path : "";
  const levels = query.levels === undefined ? 3 : Number(query.levels);
  const slots = treePathSlots(path).map(Number);
  if (!isMemberId(id)) throw createError({ statusCode: 400, statusMessage: "Enter a valid numeric member ID." });
  if ((path !== '' && !/^(0|[1-9]\d{0,8})(\/(0|[1-9]\d{0,8}))*$/.test(path)) || slots.length > referralTreeDepth || !Number.isInteger(levels) || levels < 1 || levels > referralTreeDepth)
    throw createError({ statusCode: 400, statusMessage: "Choose a branch within the first 15 levels." });
  const root = await db().one("SELECT id, referral_code, username FROM users WHERE referral_code = $1", id);
  if (!root) throw createError({ statusCode: 404, statusMessage: "No member was found with that ID." });
  const visibleDepth = Math.min(levels, referralTreeDepth - slots.length);
  const result = await db().one(`WITH RECURSIVE network AS (
    SELECT u.id, u.referral_code, u.username, NULL::TEXT AS parent_code, ARRAY[]::INTEGER[] AS path
    FROM users u WHERE u.id = $1
    UNION ALL
    SELECT u.id, u.referral_code, u.username, n.referral_code, n.path || u.slot
    FROM network n JOIN LATERAL (
      SELECT child.id, child.referral_code, child.username,
        (ROW_NUMBER() OVER (ORDER BY child.created_at, child.id) - 1)::INTEGER AS slot
      FROM users child WHERE child.sponsor_id = n.id
    ) u ON TRUE
    WHERE cardinality(n.path) < $2
  ) SELECT
    COALESCE((SELECT json_agg(json_build_object('id', referral_code, 'username', username,
      'path', array_to_string(path, '/'), 'parentId', parent_code) ORDER BY cardinality(path), path)
      FROM network WHERE path[1:cardinality($3::INTEGER[])] = $3::INTEGER[] AND cardinality(path) <= $4), '[]'::JSON) AS members,
    COALESCE((SELECT json_agg(counts) FROM (
      SELECT cardinality(path) AS depth, COUNT(*)::INTEGER AS filled FROM network
      WHERE cardinality(path) > 0 GROUP BY cardinality(path) ORDER BY depth
    ) counts), '[]'::JSON) AS counts`, root.id, referralTreeDepth, slots, slots.length + visibleDepth);
  const counts = result!.counts as { depth: number; filled: number }[];
  return {
    root: { id: root.referral_code, username: root.username, path: "", parentId: null }, path,
    maxDepth: referralTreeDepth, visibleDepth, members: result!.members,
    levels: Array.from({ length: referralTreeDepth }, (_, index) => ({
      depth: index + 1, filled: counts.find(item => item.depth === index + 1)?.filled ?? 0,
    })),
  };
});
