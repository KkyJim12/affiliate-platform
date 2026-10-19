import { assertSameOrigin, requireUser, rateLimit } from "../../../utils/auth";
import { confirmExternalOperation } from "../../../utils/external-wallet";
export default defineEventHandler(async event => {
  assertSameOrigin(event); const user = await requireUser(event); await rateLimit(event,`external-confirm:${user.id}`,100);
  const body = await readBody(event); return confirmExternalOperation(user.id,String(body?.id ?? ""),body?.transactionHash);
});
