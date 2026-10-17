import { requireUser } from "../../utils/auth";
import { referralProgram } from "../../utils/referral";

export default defineEventHandler(event => referralProgram(requireUser(event).id));
