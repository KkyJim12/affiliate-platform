import { requireUser } from "../../../utils/auth";
import { db } from "../../../utils/database";
import { chainPurchaseStatus, type ChainPurchaseRow } from "../../../utils/referral-chain";
export default defineEventHandler(async event => {
  const user = await requireUser(event);
  const rows = await db().all<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20", user.id);
  return rows.map(chainPurchaseStatus);
});
