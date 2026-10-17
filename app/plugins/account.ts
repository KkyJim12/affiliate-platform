export default defineNuxtPlugin(async () => {
  const { user, restoreSession } = useAccount();
  const { wallet, walletError, refreshWallet } = useWallet();
  const { summary, dashboardError, refreshDashboard } = useDashboard();
  await restoreSession();
  if (user.value) await Promise.all([refreshWallet(), refreshDashboard()]);
  if (import.meta.client) {
    watch(() => user.value?.id, async () => {
      wallet.value = null;
      walletError.value = "";
      summary.value = null;
      dashboardError.value = "";
      if (user.value) await Promise.all([refreshWallet(), refreshDashboard()]);
    });
  }
});
