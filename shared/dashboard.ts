export interface DashboardSummary {
  commissions: number;
  directCommissions: number;
  bonusCommissions: number;
  pendingFunding: number;
  completedTransfers: number;
  referrals: { direct: number; total: number; depth: number; truncated: boolean };
}
