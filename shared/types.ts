export interface Account {
  id: string;
  username: string;
  referralCode: string | null;
  sponsorCode: string | null;
  createdAt: string;
  role: "member" | "admin";
}

export interface WalletTransaction {
  id: string;
  type: "deposit" | "withdrawal" | "transfer_in" | "transfer_out" | "commission" | "referral_purchase";
  amount: number;
  status: "pending" | "completed" | "rejected";
  description: string;
  createdAt: string;
}

export interface WalletSummary {
  id: string;
  currency: "USDT";
  available: number;
  reserved: number;
  earned: number;
  transactions: WalletTransaction[];
}

export interface ReferralMember {
  username: string;
  joinedAt: string;
  status: "Registered";
}

export interface ReferralNode {
  id: string;
  parentId: string;
  username: string;
  joinedAt: string;
  status: "Registered" | "Qualified";
  depth: number;
}

export interface ReferralNetwork {
  members: ReferralMember[];
  network: ReferralNode[];
  truncated: boolean;
}
