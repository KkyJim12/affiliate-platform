import { requireUser } from "../../utils/auth";
import { networkFor } from "../../utils/explorer";
export default defineEventHandler(async (event) => await networkFor(event, await requireUser(event)));
