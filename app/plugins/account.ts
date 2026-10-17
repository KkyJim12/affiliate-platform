export default defineNuxtPlugin(async () => {
  const { user, restoreSession } = useAccount();
  const { wallet, walletError, refreshWallet } = useWallet();
  await restoreSession();
  if (user.value) await refreshWallet();
  if (import.meta.client) {
    watch(() => user.value?.id, async () => {
      wallet.value = null;
      walletError.value = "";
      if (user.value) await refreshWallet();
    });
  }
});
