import { generateEncryptedEvmWallet, publicEvmWallet } from "../lib/evm-wallet";
import type { StoredEvmWallet } from "../lib/evm-wallet";
import { db, transaction } from "./database";
import { externalWalletMode, requireEmbeddedWalletMode } from "./wallet-mode";
import { polygonTestnet } from "../../shared/evm-wallet";
import type { EvmWalletDetails } from "../../shared/evm-wallet";

export async function insertEvmWallet(userId: string, row: StoredEvmWallet) {
  requireEmbeddedWalletMode();
  await db().execute(`INSERT INTO evm_wallets (user_id, address, public_key, encrypted_keystore, chain_id, created_at)
    VALUES ($1, $2, $3, $4, $5, $6)`, userId, row.address, row.public_key, row.encrypted_keystore, row.chain_id, row.created_at);
}

export async function evmWalletFor(userId: string) {
  if (externalWalletMode()) {
    const linked = await db().one("SELECT address, created_at FROM connected_wallets WHERE user_id = $1", userId);
    return linked ? { address: linked.address, publicKey: null, chainId: polygonTestnet.chainId,
      network: polygonTestnet.name, currency: polygonTestnet.currency, testnet: true,
      explorerUrl: `${polygonTestnet.explorerUrl}/address/${linked.address}`, createdAt: linked.created_at } as EvmWalletDetails : null;
  }
  const row = await db().one<Omit<StoredEvmWallet, "encrypted_keystore">>(
    "SELECT address, public_key, chain_id, created_at FROM evm_wallets WHERE user_id = $1", userId);
  return row ? publicEvmWallet(row) : null;
}

export async function ensureEvmWallet(userId: string, password: string) {
  if (externalWalletMode()) return evmWalletFor(userId);
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
