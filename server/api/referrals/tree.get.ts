import { isMemberId } from "../../../shared/referral-code";
import { treePathSlots, type ReferralTreeData } from "../../../shared/referral-tree";
import { db } from "../../utils/database";

// Both programs display the same level/cycle placement used by commissions.
export default defineEventHandler(async (event): Promise<ReferralTreeData> => {
  const query = getQuery(event);
  const id = typeof query.id === "string" ? query.id.trim() : "";
  const path = typeof query.path === "string" ? query.path : "";
  const mode = query.mode ?? "unilevel", maxDepth = mode === "matrix" ? 3 : 15;
  const levels = query.levels === undefined ? 3 : Number(query.levels);
  const level = query.level === undefined ? 1 : Number(query.level);
  const cycle = query.cycle === undefined ? 0 : Number(query.cycle);
  const slots = treePathSlots(path).map(Number);
  if (!isMemberId(id)) throw createError({ statusCode: 400, statusMessage: "Enter a valid numeric member ID." });
  if (!["matrix","unilevel"].includes(String(mode)) || (path !== "" && !/^[01](\/[01])*$/.test(path))
    || slots.length > maxDepth || !Number.isInteger(levels) || levels < 1 || levels > maxDepth
    || !Number.isInteger(level) || level < 1 || level > 15 || !Number.isSafeInteger(cycle) || cycle < 0)
    throw createError({ statusCode: 400, statusMessage: "Choose a valid binary branch, purchase level and cycle." });
  const root = await db().one("SELECT id,referral_code FROM users WHERE referral_code = $1", id);
  if (!root) throw createError({ statusCode: 404, statusMessage: "No member was found with that ID." });
  const visibleDepth = Math.min(levels, maxDepth - slots.length);
  const table = mode === "matrix" ? "matrix_slots" : "unilevel_slots";
  const cycles = await db().all<{ cycle: number }>(`SELECT cycle FROM ${table} WHERE user_id = $1 AND level = $2 AND opened ORDER BY cycle`, root.id, level);
  if (!cycles.some(item => item.cycle === cycle))
    throw createError({ statusCode: 404, statusMessage: "This referral slot does not exist." });
  const source = `SELECT s.id,COALESCE(u.referral_code, '') AS referral_code,NULL::TEXT AS parent_code,ARRAY[]::INTEGER[] AS path,s.unlocked AS purchased
      FROM ${table} s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1 AND s.level = $5 AND s.cycle = $6
      UNION ALL SELECT s.id,COALESCE(u.referral_code, '') AS referral_code,n.referral_code,n.path || s.branch::INTEGER,s.unlocked
      FROM network n JOIN ${table} s ON s.parent_id = n.id JOIN users u ON u.id = s.user_id`;
  const result = await db().one(`WITH RECURSIVE network AS (
    ${source} WHERE cardinality(n.path) < $2
  ) SELECT
    (SELECT json_build_object('id',referral_code,'path','','parentId',NULL,'purchased',purchased)
      FROM network WHERE cardinality(path) = 0) AS root,
    COALESCE((SELECT json_agg(json_build_object('id',referral_code,'path',array_to_string(path,'/'),'parentId',parent_code,'purchased',purchased)
      ORDER BY cardinality(path),path) FROM network
      WHERE path[1:cardinality($3::INTEGER[])] = $3::INTEGER[] AND cardinality(path) <= $4),'[]'::JSON) AS members,
    COALESCE((SELECT json_agg(counts) FROM (
      SELECT cardinality(path) AS depth,COUNT(*)::INTEGER AS filled FROM network WHERE ${mode === "matrix" ? "purchased AND" : ""} cardinality(path) > 0
      GROUP BY cardinality(path) ORDER BY depth
    ) counts),'[]'::JSON) AS counts`, root.id,maxDepth,slots,slots.length + visibleDepth,level,cycle);
  const counts = result!.counts as { depth: number; filled: number }[];
  return { root: result!.root, path, maxDepth, visibleDepth,
    mode: mode as "matrix" | "unilevel", programLevel: level, cycle, cycles: cycles.map(item => item.cycle), members: result!.members,
    levels: Array.from({ length: maxDepth }, (_,index) => ({ depth: index + 1, filled: counts.find(item => item.depth === index + 1)?.filled ?? 0 })) };
});
