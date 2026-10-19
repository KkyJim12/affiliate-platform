import { assertSameOrigin, requireUser, rateLimit } from "../../../utils/auth";
import { confirmExternalPurchase } from "../../../utils/external-wallet";
import { chainActionError } from "../../../utils/referral-chain";
export default defineEventHandler(async event => {
  assertSameOrigin(event); const user = await requireUser(event); await rateLimit(event,`confirm-purchase:${user.id}`,100);
  const body = await readBody(event);
  try { return await confirmExternalPurchase(user.id,String(body?.id ?? ""),body?.transactionHash); } catch (error) { chainActionError(error); }
});
