import { Wallet } from "ethers";
import { polygonNetwork } from "../../shared/evm-wallet.ts";
import type { EvmWalletDetails } from "../../shared/evm-wallet.ts";

export interface StoredEvmWallet {
  address: string;
  public_key: string;
  encrypted_keystore: string;
  chain_id: number;
  created_at: string;
}

export async function generateEncryptedEvmWallet(password: string, chainId: number = 80002): Promise<StoredEvmWallet> {
  const network = polygonNetwork(chainId);
  if (password.length < 12 || password.length > 128) throw new Error("Invalid wallet encryption password.");
  // Retain only one random account; the keystore does not contain an HD seed.
  const wallet = new Wallet(Wallet.createRandom().privateKey);
  return { address: wallet.address, public_key: wallet.signingKey.publicKey,
    encrypted_keystore: await wallet.encrypt(password), chain_id: network.chainId,
    created_at: new Date().toISOString() };
}

export function publicEvmWallet(row: Omit<StoredEvmWallet, "encrypted_keystore">): EvmWalletDetails {
  const network = polygonNetwork(row.chain_id);
  return { address: row.address, publicKey: row.public_key, chainId: network.chainId,
    network: network.name, currency: network.currency, testnet: network.testnet,
    explorerUrl: `${network.explorerUrl}/address/${row.address}`, createdAt: row.created_at };
}

export async function decryptEvmPrivateKey(row: StoredEvmWallet, password: string): Promise<string> {
  polygonNetwork(row.chain_id);
  const wallet = await Wallet.fromEncryptedJson(row.encrypted_keystore, password);
  if (wallet.address !== row.address || wallet.signingKey.publicKey !== row.public_key)
    throw new Error("Stored wallet identity does not match its encrypted key.");
  return wallet.privateKey;
}
