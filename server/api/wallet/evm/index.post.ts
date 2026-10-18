import { assertSameOrigin, rateLimit, requireUser, verifyPassword } from "../../../utils/auth";
import { ensureEvmWallet } from "../../../utils/evm-wallet";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const user = await requireUser(event);
  await rateLimit(event, `evm-wallet-create:${user.id}`, 5);
  const body = await readBody(event);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length > 128 || !await verifyPassword(password, user.password_hash))
    throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
  return { wallet: await ensureEvmWallet(user.id, password) };
});
