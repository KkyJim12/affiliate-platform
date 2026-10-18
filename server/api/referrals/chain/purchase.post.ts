import { assertSameOrigin, rateLimit, requireUser, verifyPassword } from "../../../utils/auth";
import { parseRequestKey } from "../../../utils/wallet";
import { chainActionError, chainPurchaseStatus, parseGasBudget, submitChainPurchase } from "../../../utils/referral-chain";
export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const user = await requireUser(event);
  await rateLimit(event, `chain-purchase:${user.id}`, 30);
  const body = await readBody(event), key = parseRequestKey(body?.requestKey);
  if (!Number.isInteger(body?.level) || body.level < 1 || body.level > 15)
    throw createError({ statusCode: 400, statusMessage: "Choose a referral level between 1 and 15." });
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length > 128 || !await verifyPassword(password, user.password_hash))
    throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
  try {
    const row = await submitChainPurchase(user.id, password, body.level, key, parseGasBudget(body?.maxGasFee));
    setResponseStatus(event, row.status === "pending" ? 202 : 200);
    return chainPurchaseStatus(row);
  } catch (error) { chainActionError(error); }
});
