export default defineNuxtPlugin({ name: "account-session", async setup() {
  const { user, restoreSession } = useAccount();
  const { wallet, walletError, refreshWallet, clearBalances } = useEvmWallet();
  const { wallet: legacyCredits, walletError: legacyError } = useWallet();
  const { summary, dashboardError, refreshDashboard } = useDashboard();
  await restoreSession();
  if (user.value) await Promise.all([refreshWallet(), refreshDashboard()]);
  if (import.meta.client) {
    watch(() => user.value?.id, async () => {
      wallet.value = null;
      clearBalances();
      walletError.value = false;
      legacyCredits.value = null;
      legacyError.value = "";
      summary.value = null;
      dashboardError.value = "";
      if (user.value) await Promise.all([refreshWallet(), refreshDashboard()]);
    }, { flush: "sync" });
  }
} });
