<script setup lang="ts">
import type { EvmSendAsset, EvmSendQuote, EvmSendStatus } from "#shared/evm-send";

const props = withDefaults(defineProps<{ open: boolean; showHistory?: boolean }>(), { showHistory: true });
const emit = defineEmits<{ close: [] }>();
const { t, tr } = useLoopI18n();
const { user } = useAccount();
const { balances, refreshBalances } = useEvmWallet();
const asset = ref<EvmSendAsset>("native");
const recipient = ref("");
const amount = ref("");
const password = ref("");
const passwordField = ref<HTMLInputElement | null>(null);
const quote = ref<EvmSendQuote | null>(null);
const sends = ref<EvmSendStatus[]>([]);
const error = ref("");
const historyError = ref(false);
const busy = ref(false);
const pending = computed(() => sends.value.some(send => send.status === "pending"));
const options = computed(() => [{ value: "native" as const, label: "POL" },
  ...(balances.value?.token ? [{ value: "token" as const, label: balances.value.token.symbol }] : [])]);
const available = computed(() => asset.value === "native" ? balances.value?.native : balances.value?.token);
let version = 0;
let requestKey = "";
let polling: ReturnType<typeof setInterval> | undefined;
let loadingHistory = false;
let active = true;
const accountId = user.value?.id;
function clearPassword() { if (passwordField.value) passwordField.value.value = ""; password.value = ""; }
function reset() {
  version++; clearPassword(); quote.value = null; requestKey = ""; error.value = ""; busy.value = false;
}
function close() { reset(); emit("close"); }
async function loadHistory() {
  if (loadingHistory || !accountId || user.value?.id !== accountId || !active) return;
  loadingHistory = true;
  try {
    const result = await $fetch<{ sends: EvmSendStatus[] }>("/api/wallet/evm/sends");
    if (!active || user.value?.id !== accountId) return;
    const settled = sends.value.some(old => old.status === "pending" && result.sends.some(send => send.id === old.id && send.status !== "pending"));
    sends.value = result.sends; historyError.value = false;
    if (settled) void refreshBalances(true);
  } catch { if (active) historyError.value = true; }
  finally { loadingHistory = false; }
}
async function review() {
  if (busy.value || pending.value) return;
  const current = ++version; busy.value = true; error.value = "";
  try {
    const result = await $fetch<{ quote: EvmSendQuote }>("/api/wallet/evm/send/quote", {
      method: "POST", body: { recipient: recipient.value.trim(), asset: asset.value, amount: amount.value.trim() },
    });
    if (!active || current !== version || user.value?.id !== accountId) return;
    quote.value = result.quote; requestKey = crypto.randomUUID();
  } catch (err) {
    if (current === version) error.value = (err as { data?: { statusMessage?: string } }).data?.statusMessage || t("evmSend.requestFailed");
  } finally { if (current === version) busy.value = false; }
}
async function send() {
  if (busy.value || !quote.value || !requestKey) return;
  const current = ++version, reviewed = quote.value;
  busy.value = true; error.value = "";
  try {
    const result = await $fetch<{ send: EvmSendStatus }>("/api/wallet/evm/send", {
      method: "POST", body: { id: reviewed.id, quoteHash: reviewed.quoteHash, requestKey, password: password.value },
    });
    if (!active || user.value?.id !== accountId) return;
    sends.value = [result.send, ...sends.value.filter(item => item.id !== result.send.id)].slice(0, 20);
    void refreshBalances(true);
    if (current === version) close();
  } catch (err) {
    if (current === version) error.value = (err as { data?: { statusMessage?: string } }).data?.statusMessage || t("evmSend.requestFailed");
    void loadHistory();
  } finally { if (current === version) { clearPassword(); busy.value = false; } }
}
function visibility() { if (document.hidden) close(); }
watch(() => props.open, () => { reset(); if (props.open) { recipient.value = ""; amount.value = ""; void loadHistory(); } }, { flush: "sync" });
onMounted(() => {
  void loadHistory(); polling = setInterval(() => { if (pending.value && !document.hidden) void loadHistory(); }, 4000);
  document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", close);
});
onBeforeUnmount(() => {
  active = false; reset(); clearInterval(polling);
  document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", close);
});
</script>

<template>
  <section v-if="showHistory && (sends.length || historyError)" class="panel send-history" data-testid="evm-send-history">
    <div class="send-history-header"><h3>{{ t('evmSend.recent') }}</h3><button class="text-action" @click="loadHistory">{{ t('evmWallet.refresh') }}</button></div>
    <p v-if="historyError" role="status">{{ t('evmSend.historyFailed') }}</p>
    <article v-for="item in sends.slice(0, 5)" :key="item.id" class="send-history-row" :data-status="item.status">
      <div><strong>{{ item.amount }} {{ item.symbol }}</strong><span>{{ t(`evmSend.${item.status}`) }}</span></div>
      <code>{{ item.recipient }}</code>
      <a :href="item.explorerUrl" target="_blank" rel="noopener noreferrer">{{ t('evmSend.viewTransaction') }}<AppIcon name="ExternalLink" :size="13" /></a>
    </article>
  </section>
  <ModalTransition><AppModal v-if="open" :title="t('evmSend.title')" @close="close">
    <div class="wallet-action-modal send-dialog">
      <span class="modal-feature-icon"><AppIcon name="ArrowUpRight" :size="26" /></span>
      <h2>{{ t(quote ? 'evmSend.reviewTitle' : 'evmSend.title') }}</h2>
      <p>{{ t('evmSend.network') }}</p>
      <p v-if="pending" class="auth-error" role="status">{{ t('evmSend.waitPending') }}</p>
      <form v-if="!quote" class="account-form" @submit.prevent="review">
        <label for="send-asset">{{ t('evmSend.asset') }}</label>
        <AppDropdown id="send-asset" v-model="asset" :options="options" :label="t('evmSend.asset')" :disabled="busy || pending" />
        <p v-if="available" class="send-available">{{ t('evmSend.available') }}: {{ available.balance }} {{ available.symbol }}</p>
        <label for="send-recipient">{{ t('evmSend.recipient') }}</label>
        <input id="send-recipient" v-model="recipient" class="auth-input" type="text" autocomplete="off" spellcheck="false" required maxlength="42" placeholder="0x…" :disabled="busy || pending" />
        <label for="send-amount">{{ t('evmSend.amount') }}</label>
        <input id="send-amount" v-model="amount" class="auth-input" type="text" inputmode="decimal" autocomplete="off" required maxlength="115" placeholder="0.00" :disabled="busy || pending" />
        <p class="send-note">{{ t('evmSend.gasHint') }}</p>
        <p v-if="error" class="auth-error" role="alert">{{ tr(error) }}</p>
        <button type="submit" class="button button-orange auth-wallet-button" :disabled="busy || pending">{{ t(busy ? 'ui.please_wait' : 'evmSend.review') }}</button>
      </form>
      <form v-else class="account-form" @submit.prevent="send">
        <dl class="send-review" data-testid="evm-send-review">
          <dt>{{ t('evmSend.recipient') }}</dt><dd><code>{{ quote.recipient }}</code></dd>
          <dt>{{ t('evmSend.amount') }}</dt><dd>{{ quote.amount }} {{ quote.symbol }}</dd>
          <dt>{{ t('evmSend.maxGas') }}</dt><dd>{{ quote.gasBudget }} POL</dd>
        </dl>
        <p class="send-note">{{ t('evmSend.reviewHint') }}</p>
        <label for="send-password">{{ t('ui.confirm_with_your_password') }}</label>
        <input id="send-password" ref="passwordField" v-model="password" class="auth-input" type="password" autocomplete="current-password" required maxlength="128" :disabled="busy" />
        <p v-if="error" class="auth-error" role="alert">{{ tr(error) }}</p>
        <button type="submit" class="button button-orange auth-wallet-button" :disabled="busy || pending"><AppIcon v-if="busy" name="LoaderCircle" :size="17" class="auth-loading" />{{ t(busy ? 'ui.please_wait' : 'evmSend.confirm') }}</button>
        <button type="button" class="text-action send-edit" :disabled="busy" @click="reset">{{ t('evmSend.edit') }}</button>
      </form>
    </div>
  </AppModal></ModalTransition>
</template>

<style scoped>
.send-dialog { text-align: left; }
.send-dialog > h2, .send-dialog > p, .send-dialog > .modal-feature-icon { text-align: center; }
.send-dialog > .modal-feature-icon { display: flex; margin: 0 auto 20px; }
.send-dialog label { display: block; margin: 16px 0 8px; font-weight: 700; font-size: 13px; }
.send-note, .send-available { font-size: 12px; line-height: 1.7; opacity: .7; margin: 10px 0; overflow-wrap: anywhere; }
.send-review { border: 1px solid var(--border); padding: 16px; border-radius: 12px; margin: 20px 0; }
.send-review dt { font-size: 12px; opacity: .65; margin-top: 16px; }
.send-review dt:first-child { margin-top: 0; }
.send-review dd { font-size: 14px; margin: 6px 0 0; overflow-wrap: anywhere; }
.send-review code { font-size: 12px; line-height: 1.7; }
.send-edit { display: block; margin: 16px auto 0; }
.send-history { padding: 20px; min-width: 0; }
.send-history-header, .send-history-row > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; align-items: center; }
.send-history-header h3 { font-size: 15px; }
.send-history-header button, .send-history > p { font-size: 11px; }
.send-history-row { border-top: 1px solid var(--border); padding-top: 14px; margin-top: 14px; font-size: 12px; }
.send-history-row span { font-size: 11px; opacity: .7; }
.send-history-row[data-status="failed"] span { color: #d44646; }
.send-history-row code { display: block; font-size: 11px; overflow-wrap: anywhere; margin: 8px 0; }
.send-history-row a { display: inline-flex; align-items: center; gap: 5px; text-decoration: underline; }
</style>
