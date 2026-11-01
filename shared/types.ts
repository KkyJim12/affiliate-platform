export interface Account {
  id: string;
  // Blank until the first confirmed purchase, except the first signup (ID 1).
  memberId: string;
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
  memberId: string;
  joinedAt: string;
  status: "Registered";
}

export interface ReferralNode {
  id: string;
  parentId: string;
  memberId: string;
  joinedAt: string;
  status: "Registered" | "Qualified";
  depth: number;
}

export interface ReferralNetwork {
  members: ReferralMember[];
  network: ReferralNode[];
  truncated: boolean;
}
