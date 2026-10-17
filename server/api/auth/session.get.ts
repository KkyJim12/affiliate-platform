import { accountFor, currentUser } from "../../utils/auth";
export default defineEventHandler(async (event) => {
    const user = await currentUser(event);
    return { user: user ? await accountFor(user) : null };
});
