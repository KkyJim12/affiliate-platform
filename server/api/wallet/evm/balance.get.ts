import { requireUser, rateLimit } from "../../../utils/auth";
import { evmWalletFor } from "../../../utils/evm-wallet";
import { createWalletBalanceReader } from "../../../lib/evm-balance";
import { walletEvmConfig } from "../../../utils/network";

export default defineEventHandler(async event => {
  const user = await requireUser(event);
  await rateLimit(event, `evm-balance:${user.id}`, 60);
  const wallet = await evmWalletFor(user.id);
  if (!wallet) throw createError({ statusCode: 404, statusMessage: "Create your EVM wallet first." });
  try {
    return await createWalletBalanceReader(walletEvmConfig())(wallet.address);
  } catch {
    // RPC URLs can contain credentials; never expose provider errors to clients.
    throw createError({ statusCode: 503, statusMessage: "On-chain balances are temporarily unavailable. Please try again." });
  }
});
