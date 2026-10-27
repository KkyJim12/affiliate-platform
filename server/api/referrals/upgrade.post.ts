import { accountFor, assertSameOrigin, rateLimit, requireUser, verifyPassword } from "../../utils/auth";
import { buyReferralLevel } from "../../utils/compensation";
import { referralProgram } from "../../utils/referral";
import { parseRequestKey, walletFor } from "../../utils/wallet";
export default defineEventHandler(async (event) => {
  assertSameOrigin(event);
  const user = await requireUser(event);
  await rateLimit(event, `referral-upgrade:${user.id}`, 30);
  const body = await readBody(event);
  const key = parseRequestKey(body?.requestKey);
  if (typeof body?.level !== "number" || !Number.isInteger(body.level) || body.level < 2 || body.level > 15)
    throw createError({ statusCode: 400, statusMessage: "Choose a referral level between 1 and 15." });
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length > 128 || !await verifyPassword(password, user.password_hash))
    throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
  await buyReferralLevel(user.id, body.level, key);
  return { user: await accountFor(user), wallet: await walletFor(user.id), program: await referralProgram(user.id) };
});
