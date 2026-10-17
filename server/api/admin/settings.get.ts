import { requireAdmin } from "../../utils/auth";
import { platformSettings } from "../../utils/admin";
export default defineEventHandler(event => { requireAdmin(event); return platformSettings(); });
