import type { EvmWalletBalances, EvmWalletDetails } from "#shared/evm-wallet";

export function useEvmWallet() {
  const { user } = useAccount();
  // Public metadata only. Passwords and decrypted keys stay inside WalletPanel.
  const wallet = useState<EvmWalletDetails | null>("evm-wallet", () => null);
  const walletError = useState("evm-wallet-error", () => false);
  const balances = useState<EvmWalletBalances | null>("evm-wallet-balances", () => null);
  const balanceLoading = useState("evm-balance-loading", () => false);
  const balanceError = useState("evm-balance-error", () => false);
  const balanceOwner = useState<string | null>("evm-balance-owner", () => null);
  const balanceVersion = useState("evm-balance-version", () => 0);
  const balanceReadAt = useState("evm-balance-read-at", () => 0);
  const request = useRequestFetch();

  function clearBalances() {
    balanceVersion.value++;
    balances.value = null;
    balanceLoading.value = false;
    balanceError.value = false;
    balanceOwner.value = null;
    balanceReadAt.value = 0;
  }
  async function refreshBalances(force = false) {
    if (import.meta.server) return;
    const accountId = user.value?.id;
    if (!accountId) { clearBalances(); return; }
    if (balanceOwner.value !== accountId) clearBalances();
    balanceOwner.value = accountId;
    // Share an in-flight read and a short-lived snapshot across the navbar/card.
    if (balanceLoading.value || (!force && balances.value && Date.now() - balanceReadAt.value < 30_000)) return;
    const version = ++balanceVersion.value;
    balanceLoading.value = true;
    balanceError.value = false;
    try {
      const result = await $fetch<EvmWalletBalances>("/api/wallet/evm/balance");
      if (version !== balanceVersion.value || user.value?.id !== accountId) return;
      balances.value = result;
      balanceReadAt.value = Date.now();
    } catch {
      if (version === balanceVersion.value && user.value?.id === accountId) {
        balances.value = null;
        balanceError.value = true;
        balanceReadAt.value = 0;
      }
    } finally {
      if (version === balanceVersion.value) balanceLoading.value = false;
    }
  }
  async function refreshWallet() {
    const accountId = user.value?.id;
    if (!accountId) return;
    try {
      const result = await request<{ wallet: EvmWalletDetails | null }>("/api/wallet/evm");
      if (user.value?.id !== accountId) return;
      wallet.value = result.wallet;
      walletError.value = false;
    } catch {
      if (user.value?.id === accountId) walletError.value = true;
    }
  }
  return { wallet, walletError, refreshWallet, balances, balanceLoading, balanceError, refreshBalances, clearBalances };
}
