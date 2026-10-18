import { Wallet } from "ethers";
import { polygonTestnet } from "../../shared/evm-wallet.ts";
import type { EvmWalletDetails } from "../../shared/evm-wallet.ts";

export interface StoredEvmWallet {
  address: string;
  public_key: string;
  encrypted_keystore: string;
  chain_id: number;
  created_at: string;
}

export async function generateEncryptedEvmWallet(password: string): Promise<StoredEvmWallet> {
  if (password.length < 12 || password.length > 128) throw new Error("Invalid wallet encryption password.");
  // Retain only one random account; the keystore does not contain an HD seed.
  const wallet = new Wallet(Wallet.createRandom().privateKey);
  return { address: wallet.address, public_key: wallet.signingKey.publicKey,
    encrypted_keystore: await wallet.encrypt(password), chain_id: polygonTestnet.chainId,
    created_at: new Date().toISOString() };
}

export function publicEvmWallet(row: Omit<StoredEvmWallet, "encrypted_keystore">): EvmWalletDetails {
  if (row.chain_id !== polygonTestnet.chainId) throw new Error("Unexpected wallet network.");
  return { address: row.address, publicKey: row.public_key, chainId: polygonTestnet.chainId,
    network: polygonTestnet.name, currency: polygonTestnet.currency, testnet: true,
    explorerUrl: `${polygonTestnet.explorerUrl}/address/${row.address}`, createdAt: row.created_at };
}

export async function decryptEvmPrivateKey(row: StoredEvmWallet, password: string): Promise<string> {
  if (row.chain_id !== polygonTestnet.chainId) throw new Error("Unexpected wallet network.");
  const wallet = await Wallet.fromEncryptedJson(row.encrypted_keystore, password);
  if (wallet.address !== row.address || wallet.signingKey.publicKey !== row.public_key)
    throw new Error("Stored wallet identity does not match its encrypted key.");
  return wallet.privateKey;
}
