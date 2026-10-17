import type { DashboardSummary } from "../../shared/dashboard";

export function useDashboard() {
  const { user } = useAccount();
  const summary = useState<DashboardSummary | null>("dashboard-summary", () => null);
  const dashboardError = useState("dashboard-error", () => "");
  const request = useRequestFetch();

  async function refreshDashboard() {
    const accountId = user.value?.id;
    if (!accountId) return;
    try {
      const result = await request<DashboardSummary>("/api/dashboard");
      if (user.value?.id !== accountId) return;
      summary.value = result;
      dashboardError.value = "";
    } catch {
      if (user.value?.id === accountId) dashboardError.value = "Your account activity could not be loaded. Please refresh to try again.";
    }
  }
  return { summary, dashboardError, refreshDashboard };
}
