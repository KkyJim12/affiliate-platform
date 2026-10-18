import { generateEncryptedEvmWallet, publicEvmWallet } from "../lib/evm-wallet";
import type { StoredEvmWallet } from "../lib/evm-wallet";
import { db, transaction } from "./database";

export async function insertEvmWallet(userId: string, row: StoredEvmWallet) {
  await db().execute(`INSERT INTO evm_wallets (user_id, address, public_key, encrypted_keystore, chain_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)`, userId, row.address, row.public_key, row.encrypted_keystore, row.chain_id, row.created_at);
}

export async function evmWalletFor(userId: string) {
  const row = await db().one<Omit<StoredEvmWallet, "encrypted_keystore">>(
    "SELECT address, public_key, chain_id, created_at FROM evm_wallets WHERE user_id = $1", userId);
  return row ? publicEvmWallet(row) : null;
}

export async function ensureEvmWallet(userId: string, password: string) {
  const existing = await evmWalletFor(userId);
  if (existing) return existing;
  const generated = await generateEncryptedEvmWallet(password);
  return await transaction(async () => {
    // Serialize first sign-ins and explicit provisioning for legacy accounts.
    if (!await db().one("SELECT id FROM users WHERE id = $1 FOR UPDATE", userId)) throw new Error("Wallet owner is unavailable.");
    if (!await evmWalletFor(userId)) await insertEvmWallet(userId, generated);
    return (await evmWalletFor(userId))!;
  });
}
