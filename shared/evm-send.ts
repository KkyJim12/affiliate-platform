export type EvmSendAsset = "native" | "token";
export interface EvmSendQuote {
  id: string; quoteHash: string; sender: string; recipient: string; asset: EvmSendAsset;
  tokenAddress: string | null; symbol: string; decimals: number; amount: string;
  gasBudget: string; chainId: 137 | 80002; expiresAt: string;
}
export interface EvmSendStatus {
  id: string; status: "pending" | "confirmed" | "failed"; recipient: string;
  asset: EvmSendAsset; amount: string; symbol: string; transactionHash: string;
  explorerUrl: string; createdAt: string;
}
