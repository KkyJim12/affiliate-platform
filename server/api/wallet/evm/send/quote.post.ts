import { assertSameOrigin, rateLimit, requireUser } from "../../../../utils/auth";
import { createSendQuote, evmSendError } from "../../../../utils/evm-send";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const user = await requireUser(event);
  await rateLimit(event, `evm-send-quote:${user.id}`, 40);
  const body = await readBody(event);
  if (typeof body?.recipient !== "string" || body.recipient.length > 42 || typeof body?.amount !== "string" || body.amount.length > 115
    || body?.asset !== "native" && body?.asset !== "token") throw createError({ statusCode: 400, statusMessage: "Choose POL or the configured token." });
  try { return { quote: await createSendQuote(user.id, body.recipient, body.asset, body.amount) }; }
  catch (error) { evmSendError(error); }
});
