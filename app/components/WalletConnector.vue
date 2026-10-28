<script setup lang="ts">
const props = withDefaults(defineProps<{ purpose?: "login" | "link" | "connect"; sponsorCode?: string; showHeading?: boolean }>(), { showHeading: true });
const emit = defineEmits<{ connected: [] }>();
const { t, tr } = useLoopI18n();
const { user } = useAccount();
const { wallet, refreshWallet } = useEvmWallet();
const { providers, busy, error, reauthenticating, discover, connect, authenticate, assertConnected, failureMessage } = useConnectedWallet();
const activeId = ref<string | null>(null);
const statusId = useId();
const supported = [
  { name: "MetaMask", icon: "/wallets/metamask.svg", match: /metamask/i },
  { name: "Rabby", icon: "/wallets/rabby.png", match: /rabby/i },
  { name: "Phantom", icon: "/wallets/phantom.svg", match: /phantom/i },
];
const options = computed(() => [
  ...supported.map(option => ({ name: option.name, icon: option.icon, id: providers.value.find(provider => option.match.test(provider.name))?.id ?? null })),
  ...providers.value.filter(provider => !supported.some(option => option.match.test(provider.name)))
    .map(provider => ({ name: provider.name, icon: null, id: provider.id })),
]);
async function choose(id: string) {
  if (busy.value) return;
  busy.value = true; error.value = ""; activeId.value = id;
  try {
    if (user.value) await refreshWallet();
    const purpose = props.purpose ?? (!user.value ? "login" : wallet.value ? "connect" : "link");
    if (purpose === "connect") { await connect(id); await assertConnected(); }
    else await authenticate(id,purpose,props.sponsorCode);
    emit("connected");
  } catch (failure) { error.value = failureMessage(failure); }
  finally { busy.value = reauthenticating.value; activeId.value = null; }
}
onMounted(discover);
</script>
<template>
  <div class="wallet-connector" :aria-busy="busy">
    <p v-if="showHeading" class="wallet-connector-heading">{{ t('connected.choose') }}</p>
    <div class="connected-wallet-options">
      <button
        v-for="(option, index) in options"
        :key="option.name + (option.id ?? '')"
        type="button"
        class="wallet-provider-option"
        :class="{ 'is-available': option.id, 'is-pending': busy && activeId !== null && activeId === option.id }"
        :aria-label="option.name"
        :aria-describedby="`${statusId}-${index}`"
        :disabled="busy || !option.id"
        @click="option.id && choose(option.id)"
      >
        <span class="wallet-provider-icon" aria-hidden="true"><img v-if="option.icon" :src="option.icon" alt="" width="32" height="32" /><AppIcon v-else name="Wallet" :size="26" /></span>
        <span class="wallet-provider-copy"><strong>{{ option.name }}</strong><span :id="`${statusId}-${index}`">{{ t(busy && activeId !== null && activeId === option.id ? 'connected.connecting' : option.id ? 'connected.detected' : 'connected.notInstalled') }}</span></span>
        <AppIcon v-if="busy && activeId !== null && activeId === option.id" name="LoaderCircle" class="wallet-provider-spinner" :size="18" />
        <AppIcon v-else name="ChevronRight" class="wallet-provider-arrow" :size="18" />
      </button>
    </div>
    <p v-if="!providers.length" class="wallet-discovery-hint" role="status">{{ t('connected.notDetected') }}</p>
    <div class="wallet-discovery-actions"><span>{{ t('connected.walletMissing') }}</span><button type="button" class="text-action" :disabled="busy" @click="discover"><AppIcon name="RefreshCw" :size="13" />{{ t('connected.refreshWallets') }}</button></div>
    <p v-if="busy" class="wallet-connection-status" role="status">{{ t('connected.checkWallet') }}</p>
    <p v-if="error" class="auth-error" role="alert">{{ tr(error) }}</p>
  </div>
</template>
