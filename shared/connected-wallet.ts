export interface WalletCall {
  from: string; to: string; data: string; value: string; chainId: number; nonce?: number; gasLimit?: string;
}
export interface ExternalPurchase {
  id: string; status: import("./referral-contract").ChainPurchaseStatus; calls: (WalletCall & { stage: string })[];
}
export interface ExternalOperation {
  id: string; kind: "send" | "fee"; status: "awaiting_signature" | "pending" | "confirmed" | "failed";
  transactionHash: string | null; call: WalletCall; amount?: string; symbol?: string; recipient: string; gasBudget?: string;
}
