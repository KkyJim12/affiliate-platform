import type { ReferralAccounting } from "../../../shared/admin";
import { requireAdmin } from "../../utils/auth";
import { db } from "../../utils/database";
import { moneyScale } from "../../utils/wallet";
export default defineEventHandler(async (event): Promise<ReferralAccounting> => {
  await requireAdmin(event);
  const credited = await db().one("SELECT COALESCE(SUM(amount), 0) AS total FROM referral_allocations WHERE status = 'credited'");
  const payables = await db().all(`SELECT lower(recipient_address) AS address,
    SUM(CASE WHEN kind = 'platform' THEN amount ELSE 0 END) AS fees,
    SUM(CASE WHEN kind <> 'platform' THEN amount ELSE 0 END) AS redirected,
    SUM(amount) AS total FROM referral_allocations WHERE status = 'payable'
    GROUP BY lower(recipient_address) ORDER BY lower(recipient_address)`);
  return { credited: credited!.total / moneyScale, payables: payables.map(row => ({ address: row.address,
    platformFees: row.fees / moneyScale, redirectedShares: row.redirected / moneyScale, total: row.total / moneyScale })) };
});
