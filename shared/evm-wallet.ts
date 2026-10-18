export const polygonTestnet = {
  chainId: 80002,
  name: "Polygon Amoy",
  currency: "POL",
  rpcUrl: "https://rpc-amoy.polygon.technology/",
  explorerUrl: "https://amoy.polygonscan.com",
  testnet: true,
} as const;

export interface EvmWalletDetails {
  address: string;
  publicKey: string;
  chainId: 80002;
  network: "Polygon Amoy";
  currency: "POL";
  testnet: true;
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
