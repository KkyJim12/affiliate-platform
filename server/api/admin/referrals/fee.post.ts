import { getAddress, isAddress, ZeroAddress } from "ethers";
import { assertSameOrigin, rateLimit, requireAdmin, verifyPassword } from "../../../utils/auth";
import { parseRequestKey } from "../../../utils/wallet";
import { chainActionError, parseGasBudget, submitFeeUpdate } from "../../../utils/referral-chain";
import { requireEmbeddedWalletMode } from "../../../utils/wallet-mode";
export default defineEventHandler(async event => {
  assertSameOrigin(event);
  requireEmbeddedWalletMode();
  const admin = await requireAdmin(event);
  await rateLimit(event, `chain-fee:${admin.id}`, 20);
  const body = await readBody(event), key = parseRequestKey(body?.requestKey);
  if (typeof body?.address !== "string" || !isAddress(body.address) || getAddress(body.address) === ZeroAddress)
    throw createError({ statusCode: 400, statusMessage: "Enter a valid, nonzero EVM platform fee address." });
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length > 128 || !await verifyPassword(password, admin.password_hash))
    throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
  try {
    const update = await submitFeeUpdate(admin.id, password, body.address, key, parseGasBudget(body?.maxGasFee));
    setResponseStatus(event, update.status === "pending" ? 202 : 200);
    return { status: update.status, transactionHash: update.transaction_hash };
  } catch (error) { chainActionError(error); }
});
