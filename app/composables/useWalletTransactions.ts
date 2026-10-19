import type { WalletCall } from "#shared/connected-wallet";
interface SavedAction { id: string; hash: string; kind: "purchase" | "operation" }
export function useWalletTransactions() {
  const { user } = useAccount();
  const { send } = useConnectedWallet();
  const savedKey = () => `unxo-wallet-transactions:${user.value?.id}`;
  function saved(): SavedAction[] {
    try { return JSON.parse(localStorage.getItem(savedKey()) || "[]"); } catch { return []; }
  }
  async function record(item: SavedAction) {
    await $fetch(item.kind === "purchase" ? "/api/referrals/chain/confirm" : "/api/wallet/connected/confirm", {
      method: "POST", body: { id: item.id, transactionHash: item.hash },
    });
    localStorage.setItem(savedKey(),JSON.stringify(saved().filter(row => row.hash !== item.hash)));
  }
  async function submit(id: string,kind: SavedAction["kind"],call: WalletCall) {
    const accountId = user.value?.id, key = savedKey();
    const tx = await send(call);
    const item = { id,hash: tx.hash,kind };
    // Public transaction IDs only. Recover receipt tracking after a refresh or RPC timeout.
    try { const previous = JSON.parse(localStorage.getItem(key) || "[]") as SavedAction[]; localStorage.setItem(key,JSON.stringify([...previous.filter(row => row.id !== id),item])); } catch {}
    if (user.value?.id === accountId) { try { await record(item); } catch { /* Reconcile on the next status refresh. */ } }
    return tx;
  }
  async function recover() {
    if (!import.meta.client || !user.value) return;
    for (const item of saved()) { try { await record(item); } catch { /* Keep unacknowledged hashes for the next retry. */ } }
  }
  return { submit, recover };
}
