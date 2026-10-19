import { requireUser } from "../../../utils/auth";
import { externalOperations } from "../../../utils/external-wallet";
export default defineEventHandler(async event => externalOperations((await requireUser(event)).id));
