import { requireUser } from "../../../utils/auth";
import { referralChainStatus, pendingChainPurchase, reconcileChainPurchase } from "../../../utils/referral-chain";
export default defineEventHandler(async event => {
  const user = await requireUser(event);
  const pending = await pendingChainPurchase(user.id);
  if (pending) { try { await reconcileChainPurchase(pending); } catch { /* Report pending on provider failures. */ } }
  return referralChainStatus(user.id);
});
