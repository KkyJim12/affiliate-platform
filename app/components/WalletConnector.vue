<script setup lang="ts">
const props = defineProps<{ purpose?: "login" | "link" | "connect"; sponsorCode?: string }>();
const emit = defineEmits<{ connected: [] }>();
const { t } = useLoopI18n();
const { user } = useAccount();
const { wallet, refreshWallet } = useEvmWallet();
const { providers, busy, error, discover, connect, authenticate, assertConnected, failureMessage } = useConnectedWallet();
async function choose(id: string) {
  if (busy.value) return;
  busy.value = true; error.value = "";
  try {
    if (user.value) await refreshWallet();
    const purpose = props.purpose ?? (!user.value ? "login" : wallet.value ? "connect" : "link");
    if (purpose === "connect") { await connect(id); await assertConnected(); }
    else await authenticate(id,purpose,props.sponsorCode);
    emit("connected");
  } catch (failure) { error.value = failureMessage(failure); }
  finally { busy.value = false; }
}
onMounted(discover);
</script>
<template>
  <div class="wallet-connector">
    <p>{{ t('connected.choose') }}</p>
    <div class="connected-wallet-options">
      <button v-for="option in providers" :key="option.id" class="button button-outline" :disabled="busy" @click="choose(option.id)"><AppIcon name="Wallet" :size="18" />{{ option.name }}</button>
    </div>
    <p v-if="!providers.length" role="status">{{ t('connected.notDetected') }}</p>
    <button class="text-action" :disabled="busy" @click="discover">{{ t('connected.refreshWallets') }}</button>
    <p v-if="busy" role="status">{{ t('connected.checkWallet') }}</p>
    <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
  </div>
</template>
