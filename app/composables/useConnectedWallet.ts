import { BrowserProvider, getAddress, hexlify, toUtf8Bytes } from "ethers";
import type { WalletCall } from "#shared/connected-wallet";
import { polygonTestnet } from "#shared/evm-wallet";
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
let accountListener: ((accounts: string[]) => void) | undefined;
let chainListener: ((chain: string) => void) | undefined;
let disconnectListener: (() => void) | undefined;
let discovering = false;

export function useConnectedWallet() {
  const external = computed(() => useRuntimeConfig().public.walletMode !== "embedded");
  const providers = useState<WalletOption[]>("connected-providers", () => []);
  const address = useState<string | null>("connected-address", () => null);
  const chainId = useState<number | null>("connected-chain", () => null);
  const walletName = useState("connected-wallet-name", () => "");
  const busy = useState("connected-wallet-busy", () => false);
  const error = useState("connected-wallet-error", () => "");
  const { user } = useAccount();
  const { wallet, refreshWallet, clearBalances, refreshBalances } = useEvmWallet();
  const matches = computed(() => !!address.value && address.value.toLowerCase() === wallet.value?.address.toLowerCase() && chainId.value === polygonTestnet.chainId);

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
    if (activeProvider) {
      if (accountListener) activeProvider.removeListener?.("accountsChanged", accountListener);
      if (chainListener) activeProvider.removeListener?.("chainChanged", chainListener);
      if (disconnectListener) activeProvider.removeListener?.("disconnect", disconnectListener);
    }
    activeProvider = null; address.value = null; chainId.value = null; walletName.value = ""; error.value = "";
  }
  async function switchNetwork(provider: InjectedProvider) {
    const current = Number(await provider.request({ method: "eth_chainId" }));
    if (current !== polygonTestnet.chainId) {
      try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x13882" }] }); }
      catch (failure) {
        const code = (failure as { code?: number; data?: { originalError?: { code?: number } } }).code;
        if (code !== 4902) throw failure;
        await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x13882", chainName: polygonTestnet.name,
          nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 }, rpcUrls: [polygonTestnet.rpcUrl], blockExplorerUrls: [polygonTestnet.explorerUrl] }] });
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x13882" }] });
      }
    }
    if (Number(await provider.request({ method: "eth_chainId" })) !== polygonTestnet.chainId) throw new Error("Select Polygon Amoy in your wallet. In Phantom, enable testnet mode first.");
  }
  async function connect(id: string) {
    const provider = injected.get(id);
    if (!provider) throw new Error("Open this site in a wallet browser or install MetaMask, Rabby or Phantom, then refresh the wallet list.");
    const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
    if (!accounts?.[0]) throw new Error("Select an EVM account in your wallet.");
    await switchNetwork(provider);
    disconnect(); activeProvider = provider;
    address.value = getAddress(accounts[0]); chainId.value = polygonTestnet.chainId;
    walletName.value = providers.value.find(option => option.id === id)?.name ?? "Wallet";
    accountListener = accounts => { address.value = accounts[0] ? getAddress(accounts[0]) : null; error.value = "Wallet account changed. Use your linked account or sign in again."; };
    chainListener = chain => { chainId.value = Number(chain); error.value = chainId.value === polygonTestnet.chainId ? "" : "Select Polygon Amoy in your wallet."; };
    disconnectListener = () => { address.value = null; chainId.value = null; error.value = "Your wallet disconnected. Connect it again to continue."; };
    provider.on?.("accountsChanged", accountListener); provider.on?.("chainChanged", chainListener); provider.on?.("disconnect", disconnectListener);
    return address.value;
  }
  async function authenticate(id: string, purpose: "login" | "link", sponsorCode = "") {
    const connected = await connect(id), provider = activeProvider!;
    const ownerId = user.value?.id;
    const challenge = await $fetch<{ id: string; message: string }>("/api/auth/wallet/challenge", { method: "POST", body: { address: connected, purpose, sponsorCode } });
    const signature = await provider.request({ method: "personal_sign", params: [hexlify(toUtf8Bytes(challenge.message)), connected] });
    if (address.value !== connected || activeProvider !== provider || purpose === "link" && user.value?.id !== ownerId) throw new Error("Wallet or account changed. Please sign in again.");
    const result = await $fetch<{ user: Account }>("/api/auth/wallet/verify", { method: "POST", body: { id: challenge.id, signature } });
    user.value = result.user;
    clearBalances(); await refreshWallet(); void refreshBalances(true);
  }
  async function assertConnected(expected?: string) {
    if (!activeProvider) throw new Error("Connect your linked wallet before continuing.");
    const accounts = await activeProvider.request({ method: "eth_accounts" }) as string[];
    const actual = accounts[0] ? getAddress(accounts[0]) : null;
    address.value = actual;
    chainId.value = Number(await activeProvider.request({ method: "eth_chainId" }));
    if (!actual || actual.toLowerCase() !== (expected ?? wallet.value?.address)?.toLowerCase()) throw new Error("Select the wallet linked to this account before signing.");
    if (chainId.value !== polygonTestnet.chainId) throw new Error("Select Polygon Amoy in your wallet before signing.");
    return actual;
  }
  async function send(call: WalletCall) {
    const ownerId = user.value?.id;
    if (call.chainId !== polygonTestnet.chainId) throw new Error("Unsupported transaction network.");
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
  return { external, providers, address, chainId, walletName, busy, error, matches, discover, connect, authenticate, assertConnected, send, disconnect, failureMessage };
}
