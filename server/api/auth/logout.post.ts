import { assertSameOrigin, removeSession } from "../../utils/auth";

export default defineEventHandler((event) => {
  assertSameOrigin(event);
  removeSession(event);
  return { success: true };
});
