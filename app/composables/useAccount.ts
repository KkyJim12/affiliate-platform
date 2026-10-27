import type { Account } from "../../shared/types";

export function useAccount() {
  const user = useState<Account | null>("account", () => null);
  const sessionError = useState("session-error", () => "");
  const request = useRequestFetch();
  const authenticated = computed(() => !!user.value);
  function clearWalletState() {
    useState("evm-wallet").value = null;
    useState<number>("evm-wallet-version", () => 0).value++;
    useState("evm-wallet-loading").value = false;
    useState("evm-wallet-error").value = false;
    useState("evm-wallet-balances").value = null;
    useState("evm-balance-owner").value = null;
    useState<number>("evm-balance-version", () => 0).value++;
    useState("evm-balance-loading").value = false;
    useState("evm-balance-read-at").value = 0;
  }

  async function restoreSession() {
    const account = user.value;
    try {
      const result = await request<{ user: Account | null }>("/api/auth/session");
      if (user.value !== account) return;
      user.value = result.user;
      sessionError.value = "";
    } catch {
      if (user.value !== account) return;
      sessionError.value = "Your account could not be loaded. Please refresh to try again.";
    }
  }

  async function signIn(memberId: string, password: string) {
    const result = await $fetch<{ user: Account }>("/api/auth/login", { method: "POST", body: { memberId, password } });
    clearWalletState();
    user.value = result.user;
    sessionError.value = "";
  }

  async function register(password: string, sponsorCode: string) {
    const result = await $fetch<{ user: Account }>("/api/auth/register", { method: "POST", body: { password, sponsorCode } });
    clearWalletState();
    user.value = result.user;
    sessionError.value = "";
  }

  async function logout() {
    await $fetch("/api/auth/logout", { method: "POST" });
    clearWalletState();
    user.value = null;
    useAppUI().notify("You have signed out of Loop.");
  }

  return { user, authenticated, sessionError, restoreSession, signIn, register, logout };
}
