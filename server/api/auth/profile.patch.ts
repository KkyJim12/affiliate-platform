import { accountFor, assertSameOrigin, rateLimit, requireUser } from "../../utils/auth";
import { updateUsername } from "../../utils/username";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const user = await requireUser(event);
  await rateLimit(event, `profile:${user.id}`, 30);
  const body = await readBody(event);
  const username = await updateUsername(user.id, body?.username);
  return { user: await accountFor({ ...user, username }) };
});
