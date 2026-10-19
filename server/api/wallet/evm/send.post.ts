import { assertSameOrigin, rateLimit, requireUser, verifyPassword } from "../../../utils/auth";
import { parseRequestKey } from "../../../utils/wallet";
import { evmSendError, sendStatus, submitEvmSend } from "../../../utils/evm-send";
import { requireEmbeddedWalletMode } from "../../../utils/wallet-mode";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  requireEmbeddedWalletMode();
  const user = await requireUser(event);
  await rateLimit(event, `evm-send:${user.id}`, 20);
  const body = await readBody(event), requestKey = parseRequestKey(body?.requestKey);
  if (typeof body?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) || typeof body?.quoteHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(body.quoteHash))
    throw createError({ statusCode: 400, statusMessage: "This send quote is unavailable. Review the transfer again." });
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length > 128 || !await verifyPassword(password, user.password_hash))
    throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
  try {
    const row = await submitEvmSend(user.id, password, body.id, body.quoteHash, requestKey);
    setResponseStatus(event, row.status === "pending" ? 202 : 200);
    return { send: sendStatus(row) };
  } catch (error) { evmSendError(error); }
});
