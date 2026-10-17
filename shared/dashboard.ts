export interface DashboardSummary {
  commissions: number;
  pendingFunding: number;
  completedTransfers: number;
  referrals: { direct: number; total: number; depth: number; truncated: boolean };
}
