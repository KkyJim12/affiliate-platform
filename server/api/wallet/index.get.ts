import { requireUser } from "../../utils/auth";
import { walletFor } from "../../utils/wallet";
export default defineEventHandler(async (event) => await walletFor((await requireUser(event)).id));
