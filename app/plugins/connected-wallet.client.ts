export default defineNuxtPlugin({
  name: "connected-wallet-session",
  dependsOn: ["account-session"],
  setup() {
    const { user } = useAccount();
    const { wallet } = useEvmWallet();
    const { external, providers, discover, restore, disconnect } = useConnectedWallet();
    if (!external.value) return;
    watch(() => user.value?.id, id => { if (id) discover(); else disconnect(); }, { immediate: true });
    watch([() => user.value?.id, () => wallet.value?.address, providers], () => { void restore(); }, { immediate: true });
  },
});
