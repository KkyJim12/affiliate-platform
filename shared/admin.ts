export interface PlatformSettings {
  registrationOpen: boolean;
  fundingOpen: boolean;
  supportEmail: string;
}

export interface AdminMember {
  id: string;
  username: string;
  role: "member" | "admin";
  status: "active" | "suspended";
  referralCode: string | null;
  sponsor: string | null;
  createdAt: string;
  balance: number;
  referrals: number;
}

export interface AdminPayment {
  id: string;
  username: string;
  walletId: string;
  amount: number;
  status: "pending" | "completed" | "rejected";
  createdAt: string;
  reference: string | null;
  note: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface AdminOverview {
  accounts: number;
  active: number;
  pendingCount: number;
  pendingAmount: number;
  walletBalance: number;
  settledAmount: number;
  growth: { day: string; accounts: number }[];
  payments: AdminPayment[];
  audit: { id: string; username: string; action: string; target: string; createdAt: string }[];
}

export interface AdminList<T> { items: T[]; total: number; page: number; pageSize: number }
