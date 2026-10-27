import type { ReferralNode, WalletTransaction } from "./types";

export interface ExplorerNetwork {
  root: { id: string; memberId: string; joinedAt: string };
  members: ReferralNode[];
  truncated: boolean;
  remainingDepth: number;
}

export interface ExplorerTransaction extends WalletTransaction {
  memberId: string;
  walletId: string;
  reference: string | null;
  note: string | null;
  reviewedAt: string | null;
}

export interface ExplorerActivity {
  items: ExplorerTransaction[];
  total: number;
  page: number;
  pageSize: number;
  summary: { credits: number; debits: number; pending: number };
}
