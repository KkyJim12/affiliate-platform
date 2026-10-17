import type { Account, WalletSummary } from "./types";

export const referralPrice = 10;

export interface ReferralProgram {
  price: number;
  code: string | null;
  activatedAt: string | null;
  transactionId: string | null;
  sponsor: { username: string; code: string } | null;
}

export interface ReferralUpdate {
  user: Account;
  program: ReferralProgram;
  wallet: WalletSummary;
}
