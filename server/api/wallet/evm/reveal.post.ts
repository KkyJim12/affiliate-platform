import { assertSameOrigin, rateLimit, requireUser, verifyPassword } from "../../../utils/auth";
import { db } from "../../../utils/database";
import { decryptEvmPrivateKey } from "../../../lib/evm-wallet";
import type { StoredEvmWallet } from "../../../lib/evm-wallet";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const user = await requireUser(event);
  await rateLimit(event, `evm-wallet-reveal:${user.id}`, 5);
  const body = await readBody(event);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password || password.length > 128 || !await verifyPassword(password, user.password_hash))
    throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
  const row = await db().one<StoredEvmWallet>("SELECT address, public_key, encrypted_keystore, chain_id, created_at FROM evm_wallets WHERE user_id = $1", user.id);
  if (!row) throw createError({ statusCode: 404, statusMessage: "Create your Polygon testnet wallet first." });
  try { return { privateKey: await decryptEvmPrivateKey(row, password) }; }
  catch { throw createError({ statusCode: 500, statusMessage: "Your private key could not be unlocked. Please contact support." }); }
});
