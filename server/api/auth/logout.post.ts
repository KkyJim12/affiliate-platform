import { assertSameOrigin, removeSession } from "../../utils/auth";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    await removeSession(event);
    return { success: true };
});
