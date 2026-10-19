import { assertSameOrigin, requireUser, rateLimit } from "../../../utils/auth";
import { parseRequestKey } from "../../../utils/wallet";
import { prepareExternalOperation } from "../../../utils/external-wallet";
export default defineEventHandler(async event => {
  assertSameOrigin(event); const user = await requireUser(event); await rateLimit(event,`external-send:${user.id}`,40);
  const body = await readBody(event);
  try { return await prepareExternalOperation(user.id,parseRequestKey(body?.requestKey),"send",body); }
  catch (error) { if (error && typeof error === "object" && "statusCode" in error) throw error;
    throw createError({ statusCode: 400,statusMessage: "Check the recipient, amount, token balance and available POL, then try again." }); }
});
