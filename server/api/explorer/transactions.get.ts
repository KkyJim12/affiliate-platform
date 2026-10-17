import { requireUser } from "../../utils/auth";
import { activityFor } from "../../utils/explorer";
export default defineEventHandler(event => activityFor(event, requireUser(event)));
