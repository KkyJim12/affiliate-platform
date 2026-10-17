import { requireUser } from "../../utils/auth";
import { referralProgram } from "../../utils/referral";
export default defineEventHandler(async (event) => await referralProgram((await requireUser(event)).id));
