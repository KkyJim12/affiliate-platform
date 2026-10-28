import { id as hashId, getAddress, ZeroAddress } from "ethers";
import { db } from "./database.ts";

export interface MatrixSlot { id: string; user_id: string; level: number; cycle: number; parent_id: string | null; unlocked: boolean }

// Call inside the genealogy transaction. Repeated confirmations are harmless.
export async function unlockMatrixLevel(userId: string, level: number, database = db()) {
  await database.execute("SELECT pg_advisory_xact_lock(782438, 2)");
  await database.execute("UPDATE matrix_slots SET unlocked = TRUE WHERE user_id = $1 AND level <= $2", userId, level);
  // Opening a reserved cycle can expose another already-paid full tree.
  // Reconcile until every newly eligible cycle has been processed.
  while (true) {
    const full = await database.all<MatrixSlot>(`WITH RECURSIVE ancestors AS (
      SELECT id,parent_id,0 AS depth FROM matrix_slots WHERE user_id = $1 AND level <= $2
      UNION SELECT s.id,s.parent_id,a.depth+1 FROM ancestors a JOIN matrix_slots s ON s.id = a.parent_id WHERE a.depth < 3
    ), descendants AS (
      SELECT s.id AS root,s.id,0 AS depth,s.unlocked FROM matrix_slots s
        WHERE (s.user_id,s.level) IN (SELECT a.user_id,a.level FROM matrix_slots a JOIN ancestors n ON n.id = a.id)
      UNION ALL SELECT d.root,s.id,d.depth+1,s.unlocked FROM descendants d JOIN matrix_slots s ON s.parent_id = d.id WHERE d.depth < 3
    ) SELECT s.* FROM matrix_slots s WHERE s.opened AND s.unlocked AND s.completed_at IS NULL AND s.id IN (
      SELECT root FROM descendants WHERE depth > 0 GROUP BY root HAVING COUNT(*) = 14 AND BOOL_AND(unlocked)
    ) ORDER BY s.level,s.user_id,s.cycle`, userId, level);
    if (!full.length) break;
    const now = new Date().toISOString();
    for (const slot of full) {
      await database.execute("UPDATE matrix_slots SET completed_at = $1 WHERE id = $2 AND completed_at IS NULL", now, slot.id);
      // Reserved overflow is opened strictly in cycle order after paid completion.
      await database.execute(`INSERT INTO matrix_slots(id,user_id,level,cycle,unlocked,created_at) VALUES($1,$2,$3,$4,TRUE,$5)
        ON CONFLICT(user_id,level,cycle) DO UPDATE SET opened = TRUE,unlocked = TRUE`,
        `matrix:${slot.level}:${slot.user_id}:${slot.cycle + 1}`,slot.user_id,slot.level,slot.cycle + 1,now);
      await database.execute("SELECT queue_referral_upgrade($1,$2,$3,'matrix',$1)",slot.id,slot.user_id,slot.level);
    }
  }
  // Reconcile imported lower levels too. The progress function walks at most
  // fifteen placement ancestors and never recycles the continuous unilevel tree.
  const tiers = await database.all<{ level: number }>(`SELECT s.level FROM matrix_slots s
    LEFT JOIN unilevel_progress p ON p.user_id = s.user_id AND p.level = s.level
    WHERE s.user_id = $1 AND s.cycle = 0 AND s.unlocked AND (s.level = $2 OR p.user_id IS NULL) ORDER BY s.level`,userId,level);
  for (const tier of tiers) await database.execute("SELECT refresh_unilevel_progress($1,$2)",userId,tier.level);
}

export const matrixCycleHash = (cycleId: string) => hashId(cycleId);

// The first three entries are matrix slot ancestry; the remaining fifteen
// follow continuous binary placement, starting at the buyer's parent.
export async function referralRecipients(userId: string, level: number, mode: "external" | "embedded" | "ledger", database = db()) {
  const walletTable = mode === "external" ? "connected_wallets" : mode === "ledger" ? "wallets" : "evm_wallets";
  const walletField = mode === "ledger" ? "w.id" : "w.address";
  const ancestors = await database.all<{ id: string; position: number; address: string | null; eligible: boolean }>(`WITH RECURSIVE matrix AS (
    SELECT p.id,p.user_id,p.parent_id,1 AS depth,ARRAY[$1::TEXT,p.user_id] AS path FROM matrix_slots b
      JOIN matrix_slots p ON p.id = b.parent_id WHERE b.user_id = $1 AND b.level = $2 AND b.cycle = 0
    UNION ALL SELECT p.id,p.user_id,p.parent_id,m.depth+1,m.path || p.user_id FROM matrix m JOIN matrix_slots p ON p.id = m.parent_id
      WHERE m.depth < 3 AND NOT p.user_id = ANY(m.path)
  ), unilevel AS (
    SELECT p.parent_id AS user_id,1 AS depth,ARRAY[$1::TEXT,p.parent_id] AS path FROM referral_placements p WHERE p.user_id = $1
    UNION ALL SELECT p.parent_id,u.depth+1,u.path || p.parent_id FROM unilevel u JOIN referral_placements p ON p.user_id = u.user_id
      WHERE u.depth < 15 AND NOT p.parent_id = ANY(u.path)
  ), ancestors AS (
    SELECT user_id,depth - 1 AS position FROM matrix UNION ALL SELECT user_id,depth + 2 FROM unilevel
  ) SELECT a.user_id AS id,a.position,${walletField} AS address,
    (s.unlocked AND COALESCE(access.status,'active') = 'active' AND ${walletField} IS NOT NULL) AS eligible
    FROM ancestors a LEFT JOIN matrix_slots s ON s.user_id = a.user_id AND s.level = $2 AND s.cycle = 0
    LEFT JOIN user_access access ON access.user_id = a.user_id LEFT JOIN ${walletTable} w ON w.user_id = a.user_id`, userId, level);
  return Array.from({ length: 18 }, (_, position) => {
    const ancestor = ancestors.find(row => row.position === position);
    return { address: ancestor?.eligible ? mode === "ledger" ? ancestor.address! : getAddress(ancestor.address!) : ZeroAddress,
      userId: ancestor?.eligible ? ancestor.id : null,
      reason: ancestor?.eligible ? "upline" as const : ancestor ? "ineligible_upline" as const : "missing_upline" as const };
  });
}
