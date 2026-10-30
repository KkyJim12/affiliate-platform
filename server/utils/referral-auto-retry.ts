import { db } from "./database.ts";
import type { ReferralJob } from "./matrix.ts";

// Persist retries in the existing queue so they survive restarts. A failed
// receipt is safe to retry; an unresolved transaction must keep its purchase.
export async function retryFailedReferralJobs(database = db()) {
  await database.execute(`UPDATE referral_auto_upgrades j
    SET status='queued',purchase_id=NULL,
      last_error=CASE WHEN j.kind='rebirth'
        THEN 'The reborn payment failed; it will retry automatically.'
        ELSE 'The level upgrade failed; it will retry automatically.' END,
      last_attempt_at=CURRENT_TIMESTAMP::TEXT
    FROM referral_chain_purchases p
    WHERE j.purchase_id=p.id AND j.status='pending' AND p.status='failed'`);
}

export async function queuedReferralJobs(database = db()) {
  // The worker runs every 15 seconds. Also enforce the delay when an admin
  // refreshes status repeatedly, so a reverting contract cannot burn gas in a loop.
  return database.all<ReferralJob>(`SELECT * FROM referral_auto_upgrades
    WHERE status='queued' AND (last_attempt_at IS NULL
      OR last_attempt_at::TIMESTAMPTZ <= CURRENT_TIMESTAMP - INTERVAL '15 seconds')
    ORDER BY COALESCE(last_attempt_at,created_at),kind,level,cycle_id LIMIT 20`);
}
