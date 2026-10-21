export default defineNuxtPlugin({ name: "account-session", async setup() {
  const { user, restoreSession } = useAccount();
  const { wallet, walletError, refreshWallet, clearBalances } = useEvmWallet();
  const { wallet: legacyCredits, walletError: legacyError } = useWallet();
  const { summary, dashboardError, refreshDashboard } = useDashboard();
  if (import.meta.server) {
    await restoreSession();
    if (user.value) await Promise.all([refreshWallet(), refreshDashboard()]);
  }
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
    // Preserve the server's account snapshot during hydration. The browser's
    // session cookie can differ from the cookie sent with the document request.
    onNuxtReady(async () => {
      const accountId = user.value?.id;
      await restoreSession();
      // Account changes already refresh these through the watcher above.
      if (user.value && user.value.id === accountId) await Promise.all([refreshWallet(), refreshDashboard()]);
    });
  }
} });
