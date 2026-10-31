import { id as hashId, getAddress, ZeroAddress } from "ethers";
import { db } from "./database.ts";

export interface MatrixSlot { id: string; user_id: string; level: number; cycle: number; parent_id: string | null; unlocked: boolean }

// Call inside the genealogy transaction. Repeated confirmations are harmless.
export async function unlockMatrixLevel(userId: string, level: number, database = db()) {
  await database.execute("SELECT pg_advisory_xact_lock(782438, 2)");
  for (let tier = 1; tier <= level; tier++) await database.execute("SELECT enter_referral_level($1,$2)", userId, tier);
  await database.execute("UPDATE matrix_slots SET unlocked = TRUE WHERE user_id = $1 AND level <= $2", userId, level);
  await database.execute("UPDATE unilevel_slots SET unlocked = TRUE WHERE user_id = $1 AND level <= $2", userId, level);
  const affected = new Set([userId]);
  // Opening a reserved cycle can expose another already-paid full tree.
  // Reconcile until every newly eligible cycle has been processed.
  while (true) {
    const full = await database.all<MatrixSlot>(`WITH RECURSIVE ancestors AS (
      SELECT id,parent_id,0 AS depth FROM matrix_slots WHERE user_id = ANY($1::TEXT[]) AND level <= $2
      UNION SELECT s.id,s.parent_id,a.depth+1 FROM ancestors a JOIN matrix_slots s ON s.id = a.parent_id WHERE a.depth < 3
    ), descendants AS (
      SELECT s.id AS root,s.id,0 AS depth,s.unlocked FROM matrix_slots s
        WHERE (s.user_id,s.level) IN (SELECT a.user_id,a.level FROM matrix_slots a JOIN ancestors n ON n.id = a.id)
      UNION ALL SELECT d.root,s.id,d.depth+1,s.unlocked FROM descendants d JOIN matrix_slots s ON s.parent_id = d.id WHERE d.depth < 3
    ) SELECT s.* FROM matrix_slots s WHERE s.opened AND s.unlocked AND s.completed_at IS NULL AND s.id IN (
      SELECT root FROM descendants WHERE depth > 0 GROUP BY root HAVING COUNT(*) = 14 AND BOOL_AND(unlocked)
    ) ORDER BY s.level,s.user_id,s.cycle`, [...affected], level);
    if (!full.length) break;
    const now = new Date().toISOString();
    for (const slot of full) {
      await database.execute("UPDATE matrix_slots SET completed_at = $1 WHERE id = $2 AND completed_at IS NULL", now, slot.id);
      await database.execute("SELECT queue_referral_upgrade($1,$2,$3,'matrix',$1)",slot.id,slot.user_id,slot.level);
      // The other program can already have created a linked cycle. Use the
      // cycle reserved for this completion, retaining pre-payment migrations.
      const next = await database.one<{ cycle: number }>(`SELECT COALESCE((
        SELECT (to_jsonb(j)->>'rebirth_cycle')::INTEGER FROM referral_auto_upgrades j WHERE cycle_id=$1
      ),$2::INTEGER) AS cycle`, `rebirth:${slot.id}`,slot.cycle + 1);
      await database.execute(`INSERT INTO matrix_slots(id,user_id,level,cycle,unlocked,created_at) VALUES($1,$2,$3,$4,TRUE,$5)
        ON CONFLICT(user_id,level,cycle) DO UPDATE SET opened = TRUE,unlocked = TRUE`,
        `matrix:${slot.level}:${slot.user_id}:${next!.cycle}`,slot.user_id,slot.level,next!.cycle,now);
      await database.execute("SELECT place_program_slot($1,$2,'matrix',$3)",slot.user_id,slot.level,next!.cycle);
      affected.add(slot.user_id);
    }
  }
  // Each purchase level and rebirth has its own fifteen-step unilevel ancestry.
  const tiers = await database.all<{ level: number }>(`SELECT s.level FROM matrix_slots s
    LEFT JOIN unilevel_progress p ON p.user_id = s.user_id AND p.level = s.level
    WHERE s.user_id = $1 AND s.cycle = 0 AND s.unlocked AND (s.level = $2 OR p.user_id IS NULL) ORDER BY s.level`,userId,level);
  for (const tier of tiers) await database.execute("SELECT refresh_unilevel_progress($1,$2)",userId,tier.level);
}

export const matrixCycleHash = (cycleId: string) => hashId(cycleId);

// The first three entries are matrix slot ancestry; the remaining fifteen
// follow the selected level's unilevel slots, starting at the buyer's parent.
export async function referralRecipients(userId: string, level: number, mode: "external" | "embedded" | "ledger", database = db(), cycles = { matrix: 0, unilevel: 0 }) {
  // Call inside the genealogy transaction. Reserve the actual entry position
  // before signing a quote; confirmations and retries keep that position.
  await database.execute("SELECT enter_referral_level($1,$2)", userId, level);
  const walletTable = mode === "external" ? "connected_wallets" : mode === "ledger" ? "wallets" : "evm_wallets";
  const walletField = mode === "ledger" ? "w.id" : "w.address";
  const ancestors = await database.all<{ id: string; position: number; address: string | null; eligible: boolean }>(`WITH RECURSIVE matrix AS (
    SELECT p.id,p.user_id,p.parent_id,p.unlocked AS paid,1 AS depth,ARRAY[$1::TEXT,p.user_id] AS path FROM matrix_slots b
      JOIN matrix_slots p ON p.id = b.parent_id WHERE b.user_id = $1 AND b.level = $2 AND b.cycle = $3
    UNION ALL SELECT p.id,p.user_id,p.parent_id,p.unlocked,m.depth+1,m.path || p.user_id FROM matrix m JOIN matrix_slots p ON p.id = m.parent_id
      WHERE m.depth < 3 AND NOT p.user_id = ANY(m.path)
  ), unilevel AS (
    SELECT p.id,p.user_id,p.parent_id,p.unlocked AS paid,1 AS depth,ARRAY[$1::TEXT,p.user_id] AS path FROM unilevel_slots b
      JOIN unilevel_slots p ON p.id=b.parent_id WHERE b.user_id=$1 AND b.level=$2 AND b.cycle=$4
    UNION ALL SELECT p.id,p.user_id,p.parent_id,p.unlocked,u.depth+1,u.path || p.user_id FROM unilevel u JOIN unilevel_slots p ON p.id=u.parent_id
      WHERE u.depth < 15 AND NOT p.user_id = ANY(u.path)
  ), ancestors AS (
    SELECT user_id,paid,depth - 1 AS position FROM matrix UNION ALL SELECT user_id,paid,depth + 2 FROM unilevel
  ) SELECT a.user_id AS id,a.position,${walletField} AS address,
    (a.paid AND COALESCE(access.status,'active') = 'active' AND ${walletField} IS NOT NULL) AS eligible
    FROM ancestors a
    LEFT JOIN user_access access ON access.user_id = a.user_id LEFT JOIN ${walletTable} w ON w.user_id = a.user_id`, userId, level, cycles.matrix, cycles.unilevel);
  return Array.from({ length: 18 }, (_, position) => {
    const ancestor = ancestors.find(row => row.position === position);
    return { address: ancestor?.eligible ? mode === "ledger" ? ancestor.address! : getAddress(ancestor.address!) : ZeroAddress,
      userId: ancestor?.eligible ? ancestor.id : null,
      reason: ancestor?.eligible ? "upline" as const : ancestor ? "ineligible_upline" as const : "missing_upline" as const };
  });
}

export interface ReferralJob {
  cycle_id: string; user_id: string; level: number; kind: "upgrade" | "rebirth";
  source: "matrix" | "unilevel"; rebirth_cycle: number | null;
}

export async function rebirthRecipients(job: ReferralJob, mode: "external" | "embedded" | "ledger", database = db()) {
  const entries = await database.one<{ matrix: number; unilevel: number }>(`SELECT m.cycle AS matrix,u.cycle AS unilevel
    FROM referral_rebirth_entries e JOIN matrix_slots m ON m.id=e.matrix_slot_id
    JOIN unilevel_slots u ON u.id=e.unilevel_slot_id WHERE e.rebirth_id=$1`,job.cycle_id);
  if (entries) return referralRecipients(job.user_id,job.level,mode,database,entries);
  // Quotes queued before linked rebirths retain their original recipients.
  const cycles = { matrix: 0, unilevel: 0 };
  for (const program of ["matrix", "unilevel"] as const) {
    cycles[program] = program === job.source ? job.rebirth_cycle! : (await database.one<{ cycle: number }>(
      `SELECT cycle FROM ${program}_slots WHERE user_id=$1 AND level=$2 AND opened AND unlocked ORDER BY cycle DESC LIMIT 1`,job.user_id,job.level))?.cycle ?? 0;
  }
  return referralRecipients(job.user_id,job.level,mode,database,cycles);
}

export async function completeRebirth(job: ReferralJob, database = db()) {
  await database.execute("UPDATE referral_auto_upgrades SET status='completed',last_error=NULL WHERE cycle_id=$1",job.cycle_id);
  const entries = await database.one<{ matrix_slot_id: string; unilevel_slot_id: string }>(
    "SELECT matrix_slot_id,unilevel_slot_id FROM referral_rebirth_entries WHERE rebirth_id=$1",job.cycle_id);
  if (entries) {
    await database.execute("UPDATE matrix_slots SET unlocked=TRUE,rebirth_paid=TRUE WHERE id=$1",entries.matrix_slot_id);
    await database.execute("UPDATE unilevel_slots SET unlocked=TRUE,rebirth_paid=TRUE WHERE id=$1",entries.unilevel_slot_id);
  } else {
    await database.execute(`UPDATE ${job.source}_slots SET unlocked=TRUE,rebirth_paid=TRUE WHERE user_id=$1 AND level=$2 AND cycle=$3`,job.user_id,job.level,job.rebirth_cycle);
  }
  await unlockMatrixLevel(job.user_id,job.level,database);
}
