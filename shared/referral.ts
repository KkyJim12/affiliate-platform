import type { Account, WalletSummary } from "./types";
import { baseReferralPrice } from "./compensation";

export const referralPrice = baseReferralPrice;

export interface ReferralProgram {
  price: number;
  code: string | null;
  activatedAt: string | null;
  transactionId: string | null;
  currentLevel: number;
  maxLevel: number;
  nextLevel: number | null;
  nextPrice: number | null;
  feeConfigured: boolean;
  latestPurchase: { level: number; amount: number; commissions: number; platformPayable: number } | null;
  sponsor: { code: string } | null;
  autoUpgrade?: { level: number; kind?: 'upgrade' | 'rebirth'; status: string; lastError: string | null } | null;
}

export interface ReferralUpdate {
  user: Account;
  program: ReferralProgram;
  wallet: WalletSummary;
}
