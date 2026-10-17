import { requireAdmin } from "../../../utils/auth";
import { activityFor } from "../../../utils/explorer";
export default defineEventHandler(event => activityFor(event, requireAdmin(event), true));
