import { isMemberId } from "../../../shared/referral-code";
import { binaryTreeDepth, type BinaryReferralTree } from "../../../shared/referral-tree";
import { db } from "../../utils/database";

// Deliberately public: only numeric IDs, usernames and binary positions leave
// this endpoint. Internal UUIDs, wallets, balances and account details stay private.
export default defineEventHandler(async (event): Promise<BinaryReferralTree> => {
  const query = getQuery(event);
  const id = typeof query.id === "string" ? query.id.trim() : "";
  const path = typeof query.path === "string" ? query.path : "";
  const levels = query.levels === undefined ? 3 : Number(query.levels);
  if (!isMemberId(id)) throw createError({ statusCode: 400, statusMessage: "Enter a valid numeric member ID." });
  if (!/^[01]*$/.test(path) || path.length > binaryTreeDepth || !Number.isInteger(levels) || levels < 1 || levels > binaryTreeDepth)
    throw createError({ statusCode: 400, statusMessage: "Choose a branch within the first 15 levels." });
  const root = await db().one("SELECT id, referral_code, username FROM users WHERE referral_code = $1", id);
  if (!root) throw createError({ statusCode: 404, statusMessage: "No member was found with that ID." });
  const visibleDepth = Math.min(levels, binaryTreeDepth - path.length);
  const result = await db().one(`WITH RECURSIVE network AS (
    SELECT u.id, u.referral_code, u.username, ''::TEXT AS path FROM users u WHERE u.id = $1
    UNION ALL
    SELECT u.id, u.referral_code, u.username, n.path || p.slot::TEXT
    FROM network n JOIN referral_placements p ON p.parent_id = n.id JOIN users u ON u.id = p.user_id
    WHERE length(n.path) < $2
  ) SELECT
    COALESCE((SELECT json_agg(json_build_object('id', referral_code, 'username', username, 'path', path) ORDER BY length(path), path)
      FROM network WHERE left(path, length($3)) = $3 AND length(path) <= $4), '[]'::JSON) AS members,
    COALESCE((SELECT json_agg(counts) FROM (
      SELECT length(path) AS depth, COUNT(*)::INTEGER AS filled FROM network WHERE path <> '' GROUP BY length(path) ORDER BY depth
    ) counts), '[]'::JSON) AS counts`, root.id, binaryTreeDepth, path, path.length + visibleDepth);
  const counts = result!.counts as { depth: number; filled: number }[];
  return {
    root: { id: root.referral_code, username: root.username, path: "" }, path,
    maxDepth: binaryTreeDepth, visibleDepth, members: result!.members,
    levels: Array.from({ length: binaryTreeDepth }, (_, index) => ({
      depth: index + 1, capacity: 2 ** (index + 1), filled: counts.find(item => item.depth === index + 1)?.filled ?? 0,
    })),
  };
});
