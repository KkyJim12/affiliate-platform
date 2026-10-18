import { requireUser } from "../../../utils/auth";
import { evmWalletFor } from "../../../utils/evm-wallet";

export default defineEventHandler(async event => {
  const user = await requireUser(event);
  return { wallet: await evmWalletFor(user.id) };
});
