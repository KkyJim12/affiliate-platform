import { getAddress, verifyMessage, ZeroAddress } from "ethers";
import { polygonNetwork } from "../../shared/evm-wallet.ts";

export function walletLoginOrigin(requestOrigin: string, configuredUrl: string) {
  const requested = new URL(requestOrigin);
  const canonical = configuredUrl ? new URL(configuredUrl).origin : null;
  if (canonical && canonical !== requested.origin) throw new Error("origin");
  // Production must bind signatures to a configured domain rather than a supplied Host header.
  if (!canonical && !["localhost", "127.0.0.1", "[::1]"].includes(requested.hostname)) throw new Error("configuration");
  if (!/^https?:$/.test(requested.protocol)) throw new Error("origin");
  return canonical ?? requested.origin;
}

export function walletAddress(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid wallet address.");
  const address = getAddress(value);
  if (address === ZeroAddress) throw new Error("Invalid wallet address.");
  return address;
}
export function walletChallengeMessage(origin: string, address: string, nonce: string, issuedAt: number, purpose: "login" | "link", chainId: number = 80002) {
  const url = new URL(origin);
  if (!/^https?:$/.test(url.protocol) || !/^[a-zA-Z0-9]{8,}$/.test(nonce)) throw new Error("Invalid challenge.");
  return `${url.host} wants you to sign in with your Ethereum account:\n${walletAddress(address)}\n\n${purpose === "link" ? "Link this wallet to your existing UNXO account." : "Sign in to UNXO with this wallet."}\n\nURI: ${url.origin}\nVersion: 1\nChain ID: ${polygonNetwork(chainId).chainId}\nNonce: ${nonce}\nIssued At: ${new Date(issuedAt).toISOString()}\nExpiration Time: ${new Date(issuedAt + 300000).toISOString()}`;
}
export function verifyWalletChallenge(message: string, address: string, signature: unknown) {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
  try { return getAddress(verifyMessage(message, signature)) === walletAddress(address); } catch { return false; }
}
