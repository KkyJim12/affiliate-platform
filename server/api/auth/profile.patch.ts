import { assertSameOrigin, rateLimit, requireUser } from "../../utils/auth";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const user = await requireUser(event);
  await rateLimit(event, `profile:${user.id}`, 30);
  throw createError({ statusCode: 409, statusMessage: "Member IDs are assigned automatically and cannot be changed." });
});
