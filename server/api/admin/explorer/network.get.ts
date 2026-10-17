import { requireAdmin } from "../../../utils/auth";
import { networkFor } from "../../../utils/explorer";
export default defineEventHandler(event => networkFor(event, requireAdmin(event), true));
