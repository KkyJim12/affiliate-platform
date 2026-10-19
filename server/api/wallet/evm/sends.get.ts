import { requireUser } from "../../../utils/auth";
import { userEvmSends } from "../../../utils/evm-send";

export default defineEventHandler(async event => ({ sends: await userEvmSends((await requireUser(event)).id) }));
