export const polygonTestnet = {
  chainId: 80002,
  name: "Polygon Amoy",
  currency: "POL",
  rpcUrl: "https://rpc-amoy.polygon.technology/",
  explorerUrl: "https://amoy.polygonscan.com",
  testnet: true,
} as const;

export const polygonUsdtAddress = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
export const polygonMainnet = {
  chainId: 137, name: "Polygon", currency: "POL", rpcUrl: "https://polygon.drpc.org",
  explorerUrl: "https://polygonscan.com", testnet: false,
} as const;
export type PolygonChainId = 137 | 80002;
export function polygonNetwork(chainId: unknown = 80002) {
  const id = chainId === "" || chainId === undefined ? 80002 : Number(chainId);
  if (id === 137) return polygonMainnet;
  if (id === 80002) return polygonTestnet;
  throw new Error("Choose Polygon mainnet (137) or Amoy (80002).");
}

export interface EvmWalletDetails {
  address: string;
  publicKey: string | null;
  chainId: PolygonChainId;
  network: "Polygon Amoy" | "Polygon";
  currency: "POL";
  testnet: boolean;
  explorerUrl: string;
  createdAt: string;
}

export interface EvmAssetBalance {
  symbol: string;
  decimals: number;
  balanceUnits: string;
  balance: string;
}

export interface EvmWalletBalances {
  address: string;
  chainId: number;
  blockNumber: string;
  native: EvmAssetBalance;
  token: (EvmAssetBalance & { address: string }) | null;
}
