export interface EvmTransaction {
  id: string;
  hash: string;
  from: string;
  to: string | null;
  direction: "sent" | "received" | "self";
  kind: "native" | "erc20";
  action: "transfer" | "contractCall" | "contractCreation";
  status: "confirmed" | "failed";
  amount: string;
  symbol: string;
  tokenAddress: string | null;
  timestamp: string;
  blockNumber: string;
  transactionIndex: string;
  explorerUrl: string;
}

export interface EvmTransactionHistory {
  address: string;
  chainId: 137 | 80002;
  transactions: EvmTransaction[];
  limit: number;
}
