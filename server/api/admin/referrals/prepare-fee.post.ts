import { assertSameOrigin, requireAdmin, rateLimit } from "../../../utils/auth";
import { parseRequestKey } from "../../../utils/wallet";
import { prepareExternalOperation } from "../../../utils/external-wallet";
export default defineEventHandler(async event => {
  assertSameOrigin(event); const user = await requireAdmin(event); await rateLimit(event,`external-fee:${user.id}`,30);
  const body = await readBody(event); return prepareExternalOperation(user.id,parseRequestKey(body?.requestKey),"fee",body);
});
