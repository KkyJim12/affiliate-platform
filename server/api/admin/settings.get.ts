import { requireAdmin } from "../../utils/auth";
import { platformSettings } from "../../utils/admin";
export default defineEventHandler(async (event) => { await requireAdmin(event); return await platformSettings(); });
