import { BrowserProvider, getAddress, hexlify, toUtf8Bytes } from "ethers";
import type { WalletCall } from "#shared/connected-wallet";
import type { Account } from "#shared/types";

interface InjectedProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
  isMetaMask?: boolean; isRabby?: boolean; isPhantom?: boolean; providers?: InjectedProvider[];
}
interface WalletOption { id: string; name: string }
const injected = new Map<string, InjectedProvider>();
let activeProvider: InjectedProvider | null = null;
let activeProviderId: string | null = null;
let accountListener: ((accounts: string[]) => void) | undefined;
let chainListener: ((chain: string) => void) | undefined;
let disconnectListener: (() => void) | undefined;
let discovering = false;
let connectionVersion = 0;
let restoring = false;
let authenticationTask: Promise<void> | null = null;
let accountChangeTask: Promise<void> | null = null;
let pendingAccountChange: { provider: InjectedProvider; id: string; account: string | null } | null = null;
let sessionResetRequired = false;

export function useConnectedWallet() {
  const network = usePolygonNetwork();
  const external = computed(() => useRuntimeConfig().public.walletMode !== "embedded");
  const providers = useState<WalletOption[]>("connected-providers", () => []);
  const address = useState<string | null>("connected-address", () => null);
  const chainId = useState<number | null>("connected-chain", () => null);
  const walletName = useState("connected-wallet-name", () => "");
  const busy = useState("connected-wallet-busy", () => false);
  const error = useState("connected-wallet-error", () => "");
  const reauthenticating = useState("connected-wallet-reauthenticating", () => false);
  const { user, clearSession } = useAccount();
  const { authOpen } = useAppUI();
  const { wallet, refreshWallet, clearBalances, refreshBalances } = useEvmWallet();
  const matches = computed(() => !!address.value && address.value.toLowerCase() === wallet.value?.address.toLowerCase() && chainId.value === network.chainId);

  function discover() {
    if (import.meta.server) return;
    const add = (id: string, name: string, provider?: InjectedProvider) => {
      if (!provider || typeof provider.request !== "function" || [...injected.values()].includes(provider)) return;
      injected.set(id, provider); providers.value = [...providers.value, { id, name: name.slice(0, 40) }];
    };
    const fallbacks = () => {
      const browser = window as unknown as { ethereum?: InjectedProvider; phantom?: { ethereum?: InjectedProvider } };
      for (const provider of browser.ethereum?.providers ?? (browser.ethereum ? [browser.ethereum] : [])) {
        const name = provider.isRabby ? "Rabby" : provider.isPhantom ? "Phantom" : provider.isMetaMask ? "MetaMask" : "Browser wallet";
        add(`injected-${name}`, name, provider);
      }
      add("phantom-injected", "Phantom", browser.phantom?.ethereum);
    };
    if (!discovering) {
      discovering = true;
      window.addEventListener("eip6963:announceProvider", ((event: CustomEvent<{ info: { uuid: string; name: string; rdns: string }; provider: InjectedProvider }>) => {
        const detail = event.detail;
        if (detail?.info?.uuid && typeof detail.info.name === "string") add(detail.info.uuid, detail.info.name, detail.provider);
      }) as EventListener);
      window.addEventListener("ethereum#initialized", fallbacks);
    }
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    fallbacks();
  }
  function disconnect() {
    connectionVersion++;
    if (activeProvider) {
      if (accountListener) activeProvider.removeListener?.("accountsChanged", accountListener);
      if (chainListener) activeProvider.removeListener?.("chainChanged", chainListener);
      if (disconnectListener) activeProvider.removeListener?.("disconnect", disconnectListener);
    }
    activeProvider = null; activeProviderId = null; address.value = null; chainId.value = null; walletName.value = ""; error.value = "";
  }
  function normalizedAccount(account: unknown) {
    try { return typeof account === "string" ? getAddress(account) : null; }
    catch { return null; }
  }
  async function resetServerSession() {
    if (!sessionResetRequired) return;
    try { await $fetch("/api/auth/logout", { method: "POST" }); }
    catch { throw new Error("Your previous session could not be cleared. Please try signing in again."); }
    sessionResetRequired = false;
  }
  function accountChanged(provider: InjectedProvider, id: string, account: string | null, force = false) {
    if (provider !== activeProvider || !force && account === address.value) return;
    connectionVersion++;
    address.value = account;
    reauthenticating.value = true;
    busy.value = true;
    sessionResetRequired = true;
    // Stop rendering the previous owner's wallet/balances before any network
    // request. Late balance/session responses are invalidated by clearSession.
    clearSession();
    authOpen.value = true;
    error.value = account ? "Your wallet changed. Sign a new message to continue." : "Your wallet disconnected. Connect it again to continue.";
    pendingAccountChange = { provider, id, account };
    if (accountChangeTask) return;
    accountChangeTask = (async () => {
      while (pendingAccountChange) {
        const next = pendingAccountChange;
        pendingAccountChange = null;
        // Finish an older verification before revoking its cookie. Never let a
        // delayed signature response overwrite a newer wallet's session.
        await authenticationTask?.catch(() => {});
        try {
          await resetServerSession();
          if (pendingAccountChange) continue;
          if (!next.account || activeProvider !== next.provider) continue;
          await authenticate(next.id, "login", "", next.account);
          if (!pendingAccountChange) { error.value = ""; authOpen.value = false; }
        } catch (failure) {
          if (!pendingAccountChange) error.value = failureMessage(failure);
        }
      }
    })().finally(() => {
      accountChangeTask = null;
      reauthenticating.value = false;
      busy.value = false;
    });
  }
  function attach(provider: InjectedProvider, id: string, account: string, selectedChain: number = network.chainId) {
    disconnect(); activeProvider = provider; activeProviderId = id;
    address.value = getAddress(account); chainId.value = selectedChain;
    walletName.value = providers.value.find(option => option.id === id)?.name ?? "Wallet";
    accountListener = accounts => { accountChanged(provider, id, normalizedAccount(accounts?.[0])); };
    chainListener = chain => { chainId.value = Number(chain); error.value = chainId.value === network.chainId ? "" : `Select ${network.name} in your wallet.`; };
    disconnectListener = () => { chainId.value = null; accountChanged(provider, id, null); };
    provider.on?.("accountsChanged", accountListener); provider.on?.("chainChanged", chainListener); provider.on?.("disconnect", disconnectListener);
  }
  async function restore() {
    if (import.meta.server || !external.value || !user.value || !wallet.value || activeProvider || restoring) return;
    const version = connectionVersion, accountId = user.value.id, linked = wallet.value.address;
    let preferred: { id?: string; name?: string } = {};
    try { const saved = JSON.parse(localStorage.getItem("unxo-wallet-provider") || "{}"); if (saved && typeof saved === "object") preferred = saved; } catch {}
    const option = providers.value.find(item => item.id === preferred.id) ?? providers.value.find(item => item.name === preferred.name)
      ?? (providers.value.length === 1 ? providers.value[0] : undefined);
    const provider = option && injected.get(option.id);
    if (!option || !provider) return;
    restoring = true;
    try {
      // Read the already-authorized connection first. Matching accounts restore
      // without prompts; a changed account must complete a fresh sign-in.
      const accounts = await provider.request({ method: "eth_accounts" }) as string[];
      const network = Number(await provider.request({ method: "eth_chainId" }));
      if (connectionVersion !== version || user.value?.id !== accountId || wallet.value?.address !== linked || activeProvider) return;
      const account = normalizedAccount(accounts[0]);
      attach(provider, option.id, linked, network);
      // A wallet can change while the tab is closed or miss its account event.
      if (account?.toLowerCase() !== linked.toLowerCase()) accountChanged(provider, option.id, account);
    } catch { /* A locked or unavailable extension can be connected explicitly. */ }
    finally { restoring = false; if (user.value?.id !== accountId || wallet.value?.address !== linked) void restore(); }
  }
  async function switchNetwork(provider: InjectedProvider) {
    const current = Number(await provider.request({ method: "eth_chainId" }));
    if (current !== network.chainId) {
      try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${network.chainId.toString(16)}` }] }); }
      catch (failure) {
        const code = (failure as { code?: number; data?: { originalError?: { code?: number } } }).code;
        if (code !== 4902) throw failure;
        await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: `0x${network.chainId.toString(16)}`, chainName: network.name,
          nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: [network.rpcUrl], blockExplorerUrls: [network.explorerUrl] }] });
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${network.chainId.toString(16)}` }] });
      }
    }
    if (Number(await provider.request({ method: "eth_chainId" })) !== network.chainId) throw new Error(`Select ${network.name} in your wallet.${network.testnet ? " In Phantom, enable testnet mode first." : ""}`);
  }
  async function connect(id: string, expectedAccount?: string) {
    const provider = injected.get(id);
    if (!provider) throw new Error("Open this site in a wallet browser or install MetaMask, Rabby or Phantom, then refresh the wallet list.");
    const version = connectionVersion;
    const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
    if (!accounts?.[0]) throw new Error("Select an EVM account in your wallet.");
    await switchNetwork(provider);
    const current = await provider.request({ method: "eth_accounts" }) as string[];
    if (connectionVersion !== version || normalizedAccount(current[0]) !== normalizedAccount(accounts[0])
      || expectedAccount && normalizedAccount(accounts[0]) !== expectedAccount)
      throw new Error("Wallet or account changed. Please sign in again.");
    attach(provider, id, accounts[0]);
    try { localStorage.setItem("unxo-wallet-provider", JSON.stringify({ id, name: walletName.value })); } catch {}
    if (user.value && wallet.value && address.value?.toLowerCase() !== wallet.value.address.toLowerCase()) {
      accountChanged(provider, id, address.value, true);
      throw new Error("Wallet or account changed. Please sign in again.");
    }
    return address.value;
  }
  async function authenticate(id: string, purpose: "login" | "link", sponsorCode = "", expectedAccount?: string) {
    const previous = authenticationTask;
    const task = (async () => {
      await previous?.catch(() => {});
      await resetServerSession();
      const ownerId = user.value?.id;
      const connected = await connect(id, expectedAccount), provider = activeProvider!, version = connectionVersion;
      const assertCurrent = () => {
        if (connectionVersion !== version || address.value !== connected || activeProvider !== provider
          || chainId.value !== network.chainId || purpose === "link" && user.value?.id !== ownerId)
          throw new Error("Wallet or account changed. Please sign in again.");
      };
      const challenge = await $fetch<{ id: string; message: string }>("/api/auth/wallet/challenge", { method: "POST", body: { address: connected, purpose, sponsorCode } });
      assertCurrent();
      const signature = await provider.request({ method: "personal_sign", params: [hexlify(toUtf8Bytes(challenge.message)), connected] });
      assertCurrent();
      const result = await $fetch<{ user: Account }>("/api/auth/wallet/verify", { method: "POST", body: { id: challenge.id, signature } });
      assertCurrent();
      clearSession();
      user.value = result.user;
      clearBalances(); await refreshWallet(); void refreshBalances(true);
    })();
    authenticationTask = task;
    try { await task; }
    finally { if (authenticationTask === task) authenticationTask = null; }
  }
  async function assertConnected(expected?: string) {
    if (!activeProvider) throw new Error("Connect your linked wallet before continuing.");
    const provider = activeProvider, id = activeProviderId!, version = connectionVersion;
    const accounts = await provider.request({ method: "eth_accounts" }) as string[];
    const actual = normalizedAccount(accounts[0]);
    const observedChain = Number(await provider.request({ method: "eth_chainId" }));
    if (activeProvider !== provider || connectionVersion !== version) throw new Error("Wallet or account changed. Please sign in again.");
    if (actual !== address.value || user.value && wallet.value && actual?.toLowerCase() !== wallet.value.address.toLowerCase()) {
      accountChanged(provider, id, actual, true);
      throw new Error("Wallet or account changed. Please sign in again.");
    }
    address.value = actual;
    chainId.value = observedChain;
    if (!actual || actual.toLowerCase() !== (expected ?? wallet.value?.address)?.toLowerCase()) throw new Error("Select the wallet linked to this account before signing.");
    if (chainId.value !== network.chainId) throw new Error(`Select ${network.name} in your wallet before signing.`);
    return actual;
  }
  async function send(call: WalletCall) {
    const ownerId = user.value?.id;
    if (call.chainId !== network.chainId) throw new Error("Unsupported transaction network.");
    await assertConnected(call.from);
    if (!ownerId || ownerId !== user.value?.id || wallet.value?.address.toLowerCase() !== call.from.toLowerCase()) throw new Error("Sign in with the wallet authorizing this transaction.");
    const provider = new BrowserProvider(activeProvider!, "any");
    const signer = await provider.getSigner(call.from);
    // The extension reviews fees and requests the user's approval for every call.
    const tx = await signer.sendTransaction({ to: call.to, data: call.data, value: BigInt(call.value), chainId: call.chainId,
      ...(call.nonce !== undefined ? { nonce: call.nonce } : {}), ...(call.gasLimit ? { gasLimit: BigInt(call.gasLimit) } : {}) });
    return tx;
  }
  function failureMessage(failure: unknown) {
    const err = failure as { code?: string | number; data?: { statusMessage?: string }; shortMessage?: string; message?: string };
    if (err.code === 4001 || err.code === "ACTION_REJECTED") return "You declined the wallet request. You can try again when ready.";
    return err.data?.statusMessage || err.shortMessage || err.message || "The wallet request failed. Please try again.";
  }
  return { external, providers, address, chainId, walletName, busy, error, reauthenticating, matches, discover, restore, connect, authenticate, assertConnected, send, disconnect, failureMessage };
}
