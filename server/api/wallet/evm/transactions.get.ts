import { requireUser, rateLimit } from "../../../utils/auth";
import { evmWalletFor } from "../../../utils/evm-wallet";
import { createWalletHistoryReader } from "../../../lib/evm-transactions";

export default defineEventHandler(async event => {
  const user = await requireUser(event);
  await rateLimit(event, `evm-history:${user.id}`, 30);
  const wallet = await evmWalletFor(user.id);
  if (!wallet) throw createError({ statusCode: 404, statusMessage: "Create your EVM wallet first." });
  try {
    return await createWalletHistoryReader(useRuntimeConfig().evm)(wallet.address);
  } catch {
    // Provider URLs and errors may contain the API key. Keep them server-side.
    throw createError({ statusCode: 503, statusMessage: "Wallet transaction history is temporarily unavailable." });
  }
});
