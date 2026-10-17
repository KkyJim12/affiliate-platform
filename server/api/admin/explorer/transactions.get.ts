import { requireAdmin } from "../../../utils/auth";
import { activityFor } from "../../../utils/explorer";
export default defineEventHandler(async (event) => await activityFor(event, await requireAdmin(event), true));
