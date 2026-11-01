import { createError } from "h3";
import type { MatrixSlotCatalog } from "../../shared/matrix-slots";
import { db } from "./database";

export function slotCatalogQuery(query: Record<string, unknown>): { page: number; level: number; mode: 'matrix' | 'unilevel' } {
  const page = Number(query.page ?? 1), level = Number(query.level ?? 0);
  const mode = query.mode ?? 'matrix';
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(level) || level < 0 || level > 15)
    throw createError({ statusCode: 400, statusMessage: "Choose a valid program level and page." });
  if (mode !== 'matrix' && mode !== 'unilevel')
    throw createError({ statusCode: 400, statusMessage: "Choose a valid referral program." });
  return { page, level, mode };
}

// Public placement data only: never return account IDs, wallets or payments.
export async function referralSlotCatalog(member: { id: string; referral_code: string | null }, { page, level, mode = 'matrix' }: { page: number; level: number; mode?: 'matrix' | 'unilevel' }): Promise<MatrixSlotCatalog> {
  const pageSize = 24;
  const table = mode === 'unilevel' ? 'unilevel_slots' : 'matrix_slots';
  const depth = mode === 'unilevel' ? 15 : 3, capacity = 2 ** (depth + 1) - 2;
  const [levels, slots] = await Promise.all([
    db().all<MatrixSlotCatalog["levels"][number]>(`SELECT level,COUNT(*) AS slots,
      COUNT(*) FILTER (WHERE unlocked) AS unlocked,
      COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS completed,
      COUNT(*) FILTER (WHERE cycle > 0 AND unlocked) AS rebirths
      FROM ${table} WHERE user_id = $1 AND opened GROUP BY level ORDER BY level`,member.id),
    db().all<{ level: number; cycle: number; unlocked: boolean; completed: boolean; filled: number; paid: number }>(`WITH RECURSIVE selected AS (
      SELECT id,level,cycle,unlocked,completed_at FROM ${table}
      WHERE user_id = $1 AND opened AND ($2::INTEGER = 0 OR level = $2) ORDER BY level,cycle LIMIT $3 OFFSET $4
    ), positions AS (
      SELECT id AS root,id,unlocked,0 AS depth FROM selected
      UNION ALL SELECT p.root,s.id,s.unlocked,p.depth+1 FROM positions p
        JOIN ${table} s ON s.parent_id = p.id WHERE p.depth < ${depth}
    ) SELECT s.level,s.cycle,s.unlocked,s.completed_at IS NOT NULL AS completed,
      COUNT(*) FILTER (WHERE p.depth > 0) AS filled,
      COUNT(*) FILTER (WHERE p.depth > 0 AND p.unlocked) AS paid
      FROM selected s JOIN positions p ON p.root = s.id
      GROUP BY s.id,s.level,s.cycle,s.unlocked,s.completed_at ORDER BY s.level,s.cycle`,member.id,level,pageSize,(page-1)*pageSize),
  ]);
  return { memberId:member.referral_code ?? "",page,pageSize,levels,
    total:levels.filter(row=>!level || row.level===level).reduce((total,row)=>total+row.slots,0),
    items:slots.map(slot=>({level:slot.level,cycle:slot.cycle,
      status:!slot.unlocked ? "locked" : slot.completed ? "completed" : "open",filled:slot.filled,paid:slot.paid,capacity})),
  };
}
