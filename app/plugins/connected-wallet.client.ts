export default defineNuxtPlugin({
  name: "connected-wallet-session",
  dependsOn: ["account-session"],
  setup() {
    const { user } = useAccount();
    const { wallet } = useEvmWallet();
    const { external, providers, reauthenticating, discover, restore, disconnect } = useConnectedWallet();
    if (!external.value) return;
    // Providers and extension permissions are client-only. Restore them after
    // hydration so the first render matches the server's disconnected state.
    onNuxtReady(() => {
      watch(() => user.value?.id, id => { if (id) discover(); else if (!reauthenticating.value) disconnect(); }, { immediate: true });
      watch([() => user.value?.id, () => wallet.value?.address, providers], () => { void restore(); }, { immediate: true });
    });
  },
});
