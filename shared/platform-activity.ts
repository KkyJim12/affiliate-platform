export interface PlatformTransaction {
  hash: string;
  kind: "purchase" | "fee_update";
  status: "pending" | "confirmed" | "failed";
  from: string;
  to: string;
  recipient: string | null;
  level: number | null;
  amount: number;
  blockNumber: number | null;
  createdAt: string;
  explorerUrl: string;
}

export interface PlatformActivity {
  configured: boolean;
  contractAddress: string | null;
  chainId: 80002;
  items: PlatformTransaction[];
  total: number;
  page: number;
  pageSize: number;
  summary: { confirmed: number; pending: number; failed: number; volume: number };
}

export interface PlatformAnalytics {
  configured: boolean;
  contractAddress: string | null;
  chainId: 80002;
  updatedAt: string;
  accounts: number;
  activeMembers: number;
  buyers: number;
  purchases: number;
  transactions: number;
  volume: number;
  distributions: { direct: number; bonus: number; platform: number };
  daily: { day: string; accounts: number; purchases: number; volume: number }[];
  levels: { level: number; purchases: number; volume: number }[];
}
