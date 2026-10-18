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

  // Compatibility for existing referral credits. The member wallet uses useEvmWallet.
  return { wallet, walletError, refreshWallet };
}
