import { createError } from "h3";
import { Wallet } from "ethers";
import { decryptEvmPrivateKey, type StoredEvmWallet } from "../lib/evm-wallet";
import { db } from "./database";
import { requireEmbeddedWalletMode } from "./wallet-mode";

export async function walletSigner(userId: string, password: string) {
  requireEmbeddedWalletMode();
  const row = await db().one<StoredEvmWallet>("SELECT address, public_key, encrypted_keystore, chain_id, created_at FROM evm_wallets WHERE user_id = $1", userId);
  if (!row) throw createError({ statusCode: 409, statusMessage: "Create your Polygon testnet wallet first." });
  return new Wallet(await decryptEvmPrivateKey(row, password));
}
export async function withWalletLock<T>(userId: string, operation: () => Promise<T>) {
  const connection = await db().pool.connect();
  let locked = false;
  try {
    locked = (await connection.query("SELECT pg_try_advisory_lock(782439, hashtext($1)) AS locked", [userId])).rows[0].locked;
    if (!locked) throw createError({ statusCode: 409, statusMessage: "A wallet operation is already being prepared. Please try again." });
    return await operation();
  } finally {
    if (locked) await connection.query("SELECT pg_advisory_unlock(782439, hashtext($1))", [userId]);
    connection.release();
  }
}
export async function assertNoPendingWalletOperation(userId: string) {
  const pending = await db().one(`SELECT id FROM evm_sends WHERE user_id = $1 AND status = 'pending'
    UNION ALL SELECT id FROM referral_chain_purchases WHERE user_id = $1 AND status IN ('pending','awaiting_signature')
    UNION ALL SELECT id FROM referral_chain_fee_updates WHERE admin_id = $1 AND status = 'pending'
    UNION ALL SELECT id FROM external_wallet_operations WHERE user_id = $1 AND status = 'pending' LIMIT 1`, userId);
  if (pending) throw createError({ statusCode: 409, statusMessage: "Wait for your pending blockchain transaction to finish." });
}
