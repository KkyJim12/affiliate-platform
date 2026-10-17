import { accountFor, currentUser } from "../../utils/auth";

export default defineEventHandler((event) => {
  const user = currentUser(event);
  return { user: user ? accountFor(user) : null };
});
