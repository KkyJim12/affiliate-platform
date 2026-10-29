<script setup lang="ts">
const network = usePolygonNetwork();
import type { ExternalOperation } from "#shared/connected-wallet";
withDefaults(defineProps<{ open: boolean; showHistory?: boolean }>(), { showHistory: true });
const emit = defineEmits<{ close: [] }>();
const { t } = useLoopI18n();
const { balances, refreshBalances } = useEvmWallet();
const { matches, failureMessage } = useConnectedWallet();
const { submit, recover } = useWalletTransactions();
const asset = ref("native"), recipient = ref(""), amount = ref(""), error = ref("");
const quote = ref<ExternalOperation | null>(null), history = ref<ExternalOperation[]>([]), busy = ref(false);
const options = computed(() => [{ value: "native",label: "POL" },...(balances.value?.token ? [{ value: "token",label: balances.value.token.symbol }] : [])]);
let timer: ReturnType<typeof setInterval> | undefined;
async function refresh() { await recover(); try { history.value = await $fetch<ExternalOperation[]>("/api/wallet/connected/operations"); } catch {} }
async function review() {
  busy.value = true; error.value = "";
  try { quote.value = await $fetch<ExternalOperation>("/api/wallet/connected/send", { method: "POST",body: { asset: asset.value,recipient: recipient.value,amount: amount.value,requestKey: crypto.randomUUID() } }); }
  catch (failure) { error.value = failureMessage(failure); }
  finally { busy.value = false; }
}
async function send() {
  if (!quote.value || busy.value) return;
  busy.value = true; error.value = "";
  try { await submit(quote.value.id,"operation",quote.value.call); quote.value = null; recipient.value = ""; amount.value = ""; emit("close"); await refresh(); void refreshBalances(true); }
  catch (failure) { error.value = failureMessage(failure); }
  finally { busy.value = false; }
}
function close() { if (!busy.value) { quote.value = null; error.value = ""; emit("close"); } }
onMounted(() => { void refresh(); timer = setInterval(() => { if (history.value.some(row => row.status === "pending")) void refresh(); },5000); });
onBeforeUnmount(() => clearInterval(timer));
</script>
<template>
  <section v-if="showHistory && history.some(row => row.kind === 'send' && row.transactionHash)" class="panel send-history" data-testid="connected-send-history">
    <div class="send-history-header"><h3>{{ t('evmSend.recent') }}</h3><button class="text-action" @click="refresh">{{ t('evmWallet.refresh') }}</button></div>
    <article v-for="item in history.filter(row => row.kind === 'send' && row.transactionHash).slice(0,5)" :key="item.id" class="send-history-row"><strong>{{ item.amount }} {{ item.symbol }}</strong><span>{{ t(`connected.${item.status}`) }}</span><code class="connected-address">{{ item.recipient }}</code><a :href="`${network.explorerUrl}/tx/${item.transactionHash}`" target="_blank" rel="noopener noreferrer">{{ t('onchain.viewTransaction') }}</a></article>
  </section>
  <ModalTransition><AppModal v-if="open" :title="t('evmSend.title')" @close="close"><div class="wallet-action-modal send-dialog"><h2>{{ t(quote ? 'evmSend.reviewTitle' : 'evmSend.title') }}</h2><p>{{ t('connected.confirmInWallet') }}</p>
    <form v-if="!quote" class="account-form" @submit.prevent="review"><label for="external-send-asset">{{ t('evmSend.asset') }}</label><AppDropdown id="external-send-asset" v-model="asset" :options="options" :label="t('evmSend.asset')" :disabled="busy" />
      <label for="external-recipient">{{ t('evmSend.recipient') }}</label><input id="external-recipient" v-model="recipient" class="auth-input" required maxlength="42" placeholder="0x…" :disabled="busy" />
      <label for="external-amount">{{ t('evmSend.amount') }}</label><input id="external-amount" v-model="amount" class="auth-input" required inputmode="decimal" :disabled="busy" />
      <button class="button button-orange" :disabled="busy || !matches">{{ t('evmSend.reviewTitle') }}</button></form>
    <div v-else><dl class="admin-details"><div><dt>{{ t('evmSend.recipient') }}</dt><dd class="connected-address">{{ quote.recipient }}</dd></div><div><dt>{{ t('evmSend.amount') }}</dt><dd>{{ quote.amount }} {{ quote.symbol }}</dd></div><div><dt>{{ t('connected.estimatedGas') }}</dt><dd>{{ quote.gasBudget }} POL</dd></div></dl>
      <button class="button button-orange" :disabled="busy || !matches" @click="send">{{ t('connected.signAndSend') }}</button><button class="text-action" :disabled="busy" @click="quote = null">{{ t('connected.edit') }}</button></div>
    <p v-if="busy" role="status">{{ t('connected.checkWallet') }}</p><p v-if="error" class="auth-error" role="alert">{{ error }}</p>
  </div></AppModal></ModalTransition>
</template>

<style scoped>
.send-history { padding: 22px; min-width: 0; }
.send-history-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.send-history-header h3 { color: var(--text-primary); font-size: 15px; font-weight: 650; }
.send-history-header button { font-size: 11px; }
.send-history-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 9px 12px; padding-top: 16px; margin-top: 16px; border-top: 1px solid var(--border); font-size: 12px; }
.send-history-row strong { color: var(--text-primary); overflow-wrap: anywhere; }
.send-history-row > span { color: var(--text-secondary); font-size: 11px; }
.send-history-row code { grid-column: 1 / -1; color: var(--text-secondary); font-size: 11px; }
.send-history-row a { grid-column: 1 / -1; color: var(--gold-text); font-size: 11px; text-decoration: underline; }
</style>
