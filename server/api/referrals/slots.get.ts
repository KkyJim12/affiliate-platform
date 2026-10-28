import type { MatrixSlotCatalog } from "../../../shared/matrix-slots";
import { requireUser } from "../../utils/auth";
import { db } from "../../utils/database";

// Paid progress is private: the member is always taken from the session.
export default defineEventHandler(async (event): Promise<MatrixSlotCatalog> => {
  const user = await requireUser(event);
  const query = getQuery(event);
  const page = Number(query.page ?? 1), level = Number(query.level ?? 0), pageSize = 24;
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(level) || level < 0 || level > 15)
    throw createError({ statusCode: 400, statusMessage: "Choose a valid matrix level and page." });
  const [levels, slots] = await Promise.all([
    db().all<MatrixSlotCatalog["levels"][number]>(`SELECT level,COUNT(*) AS slots,
      COUNT(*) FILTER (WHERE unlocked) AS unlocked,
      COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS completed,
      COUNT(*) FILTER (WHERE cycle > 0 AND unlocked) AS rebirths
      FROM matrix_slots WHERE user_id = $1 GROUP BY level ORDER BY level`,user.id),
    db().all<{ level: number; cycle: number; unlocked: boolean; completed: boolean; filled: number; paid: number }>(`WITH RECURSIVE selected AS (
      SELECT id,level,cycle,unlocked,completed_at FROM matrix_slots
      WHERE user_id = $1 AND ($2::INTEGER = 0 OR level = $2) ORDER BY level,cycle LIMIT $3 OFFSET $4
    ), positions AS (
      SELECT id AS root,id,unlocked,0 AS depth FROM selected
      UNION ALL SELECT p.root,s.id,s.unlocked,p.depth+1 FROM positions p
        JOIN matrix_slots s ON s.parent_id = p.id WHERE p.depth < 3
    ) SELECT s.level,s.cycle,s.unlocked,s.completed_at IS NOT NULL AS completed,
      COUNT(*) FILTER (WHERE p.depth > 0) AS filled,
      COUNT(*) FILTER (WHERE p.depth > 0 AND p.unlocked) AS paid
      FROM selected s JOIN positions p ON p.root = s.id
      GROUP BY s.id,s.level,s.cycle,s.unlocked,s.completed_at ORDER BY s.level,s.cycle`,user.id,level,pageSize,(page-1)*pageSize),
  ]);
  return { memberId:user.referral_code,page,pageSize,levels,
    total:levels.filter(row=>!level || row.level===level).reduce((total,row)=>total+row.slots,0),
    items:slots.map(slot=>({level:slot.level,cycle:slot.cycle,
      status:!slot.unlocked ? "locked" : slot.completed ? "completed" : "open",filled:slot.filled,paid:slot.paid,capacity:14})),
  };
});
