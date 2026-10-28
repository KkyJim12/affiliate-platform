import { assertSameOrigin, requireUser, rateLimit } from "../../../utils/auth";
import { parseRequestKey } from "../../../utils/wallet";
import { prepareExternalPurchase } from "../../../utils/external-wallet";
import { chainActionError } from "../../../utils/referral-chain";
export default defineEventHandler(async event => {
  assertSameOrigin(event); const user = await requireUser(event); await rateLimit(event,`prepare-purchase:${user.id}`,40);
  const body = await readBody(event);
  if (!Number.isInteger(body?.level) || body.level < 1 || body.level > 15) throw createError({ statusCode: 400,statusMessage: "Choose a level between 1 and 15." });
  try { return await prepareExternalPurchase(user.id,body.level,parseRequestKey(body?.requestKey),body?.automaticApproval === true); } catch (error) { chainActionError(error); }
});
