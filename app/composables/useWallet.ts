import type { WalletSummary } from "../../shared/types";

export function useWallet() {
  const { user } = useAccount();
  const wallet = useState<WalletSummary | null>("internal-wallet", () => null);
  const walletError = useState("wallet-error", () => "");
  const request = useRequestFetch();

  async function refreshWallet() {
    const accountId = user.value?.id;
    if (!accountId) return;
    try {
      const result = await request<WalletSummary>("/api/wallet");
      if (user.value?.id !== accountId) return;
      wallet.value = result;
      walletError.value = "";
    } catch {
      if (user.value?.id === accountId) walletError.value = "Your wallet could not be loaded. Try refreshing your balance.";
    }
  }

  async function requestDeposit(amount: string, requestKey: string) {
    wallet.value = await $fetch<WalletSummary>("/api/wallet/deposit", { method: "POST", body: { amount, requestKey } });
  }

  async function transfer(amount: string, recipient: string, password: string, requestKey: string) {
    wallet.value = await $fetch<WalletSummary>("/api/wallet/transfer", { method: "POST", body: { amount, recipient, password, requestKey } });
  }

  return { wallet, walletError, refreshWallet, requestDeposit, transfer };
}
