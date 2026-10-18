<script setup lang="ts">
import type { EvmTransaction, EvmTransactionHistory } from "#shared/evm-transactions";

const props = defineProps<{ preview?: boolean }>();
const { user } = useAccount();
const { wallet } = useEvmWallet();
const { t, localeTag, formatDate } = useLoopI18n();
const { authOpen, copy } = useAppUI();
const history = ref<EvmTransactionHistory | null>(null);
const loading = ref(false);
const failed = ref(false);
const missingWallet = ref(false);
const search = ref("");
const direction = ref("all");
const visibleLimit = ref(10);
const headingId = `wallet-transactions-${useId()}`;
let version = 0;
let mounted = false;
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  return (history.value?.transactions || []).filter(item => (direction.value === "all" || item.direction === direction.value)
    && (!query || [item.hash, item.from, item.to || "", item.symbol].some(value => value.toLowerCase().includes(query))));
});

async function load() {
  const requestVersion = ++version;
  const accountId = user.value?.id;
  history.value = null;
  failed.value = false;
  missingWallet.value = false;
  visibleLimit.value = 10;
  loading.value = false;
  if (props.preview || !accountId) return;
  loading.value = true;
  try {
    const result = await $fetch<EvmTransactionHistory>("/api/wallet/evm/transactions", { retry: 0 });
    if (requestVersion === version && user.value?.id === accountId) history.value = result;
  } catch (error) {
    if (requestVersion !== version || user.value?.id !== accountId) return;
    missingWallet.value = (error as { statusCode?: number }).statusCode === 404;
    failed.value = !missingWallet.value;
  } finally {
    if (requestVersion === version) loading.value = false;
  }
}
function short(value: string) { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function amount(item: EvmTransaction) {
  const [whole = "0", fraction = ""] = item.amount.split(".");
  const format = new Intl.NumberFormat(localeTag.value);
  const decimal = format.formatToParts(1.1).find(part => part.type === "decimal")?.value ?? ".";
  const small = whole === "0" && fraction && !/[1-9]/.test(fraction.slice(0, 6)) && /[1-9]/.test(fraction);
  return small ? `<0${decimal}000001` : format.format(BigInt(whole)) + decimal + fraction.slice(0, 6).padEnd(2, "0");
}
function signedAmount(item: EvmTransaction) {
  if (item.status === "failed" || item.direction === "self" || !/[1-9]/.test(item.amount)) return amount(item);
  return (item.direction === "sent" ? "−" : "+") + amount(item);
}
function counterparty(item: EvmTransaction) { return item.direction === "received" ? item.from : item.to; }
function date(timestamp: string) {
  return formatDate(timestamp, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
}
watch([direction, search], () => { visibleLimit.value = 10; });
watch(() => user.value?.id, () => {
  version++;
  history.value = null;
  failed.value = false;
  missingWallet.value = false;
  loading.value = false;
  search.value = "";
  direction.value = "all";
  if (mounted) void load();
}, { flush: "sync" });
watch(() => props.preview, () => { if (mounted) void load(); });
watch(() => wallet.value?.address, address => {
  if (mounted && address && !loading.value && (missingWallet.value || (history.value && history.value.address !== address))) void load();
});
onMounted(() => { mounted = true; void load(); });
onBeforeUnmount(() => { mounted = false; version++; });
</script>

<template>
  <section class="panel wallet-transactions" data-testid="wallet-transactions" :aria-labelledby="headingId">
    <div class="section-card-header transactions-header">
      <div><h2 :id="headingId">{{ t('walletTransactions.title') }}</h2><p>{{ t('walletTransactions.subtitle') }}</p></div>
      <div class="transactions-actions"><a v-if="wallet && !preview" class="text-action" :href="wallet.explorerUrl" target="_blank" rel="noopener noreferrer">{{ t('walletTransactions.explorer') }}<AppIcon name="ExternalLink" :size="14" /></a><button v-if="!preview && user" class="button button-outline button-small" :disabled="loading" :aria-label="t('walletTransactions.refresh')" @click="load"><AppIcon name="RefreshCw" :size="14" :class="{ 'auth-loading': loading }" />{{ t('walletTransactions.refreshLabel') }}</button></div>
    </div>
    <div v-if="preview || !user" class="transactions-state"><span class="empty-icon"><AppIcon name="LockKeyhole" :size="24" /></span><h3>{{ t('walletTransactions.signInTitle') }}</h3><p>{{ t('walletTransactions.signInHint') }}</p><button class="button button-orange button-small" @click="authOpen = true">{{ t('ui.sign_in') }}<AppIcon name="ArrowRight" :size="14" /></button></div>
    <div v-else-if="loading" class="transactions-state" role="status"><AppIcon class="auth-loading" name="LoaderCircle" :size="23" /><p>{{ t('walletTransactions.loading') }}</p></div>
    <div v-else-if="failed" class="transactions-state" role="alert"><span class="empty-icon"><AppIcon name="Info" :size="24" /></span><h3>{{ t('walletTransactions.unavailable') }}</h3><p>{{ t('walletTransactions.unavailableHint') }}</p><button class="button button-outline button-small" @click="load">{{ t('evmWallet.retry') }}</button></div>
    <div v-else-if="missingWallet" class="transactions-state"><span class="empty-icon"><AppIcon name="Wallet" :size="24" /></span><h3>{{ t('walletTransactions.createFirst') }}</h3><p>{{ t('evmWallet.createHint') }}</p></div>
    <template v-else-if="history">
      <div v-if="history.transactions.length" class="transactions-toolbar"><label class="search-field"><AppIcon name="Search" :size="16" /><input v-model="search" type="search" :aria-label="t('walletTransactions.search')" :placeholder="t('walletTransactions.search')" /></label><AppDropdown v-model="direction" :label="t('walletTransactions.filter')" :options="[{ value: 'all', label: t('walletTransactions.all') }, { value: 'received', label: t('walletTransactions.received') }, { value: 'sent', label: t('walletTransactions.sent') }, { value: 'self', label: t('walletTransactions.self') }]" /></div>
      <div v-if="!filtered.length" class="transactions-state"><span class="empty-icon"><AppIcon name="List" :size="25" /></span><h3>{{ history.transactions.length ? t('walletTransactions.noMatches') : t('walletTransactions.empty') }}</h3><p>{{ history.transactions.length ? t('walletTransactions.adjustFilters') : t('walletTransactions.emptyHint') }}</p></div>
      <ul v-else class="transactions-list">
        <li v-for="item in filtered.slice(0, visibleLimit)" :key="item.id" class="onchain-transaction" data-testid="onchain-transaction">
          <span class="onchain-transaction-icon" :class="{ sent: item.direction === 'sent', failed: item.status === 'failed' }"><AppIcon :name="item.status === 'failed' ? 'X' : item.direction === 'received' ? 'ArrowDownLeft' : item.direction === 'self' ? 'RefreshCw' : 'ArrowUpRight'" :size="18" /></span>
          <div class="onchain-transaction-info"><div class="onchain-transaction-label"><strong>{{ t(`walletTransactions.${item.action === 'transfer' ? item.direction : item.action}`) }}</strong><span class="onchain-status" :class="item.status">{{ t(`walletTransactions.${item.status}`) }}</span></div><button v-if="counterparty(item)" class="onchain-counterparty" :title="counterparty(item)!" :aria-label="t('walletTransactions.copyAddress')" @click="copy(counterparty(item)!)"><code>{{ short(counterparty(item)!) }}</code><AppIcon name="Copy" :size="12" /></button><span v-else class="onchain-counterparty">{{ t('walletTransactions.contractCreation') }}</span><div class="onchain-transaction-meta"><time :datetime="item.timestamp">{{ date(item.timestamp) }}</time><a :href="item.explorerUrl" target="_blank" rel="noopener noreferrer" :aria-label="t('walletTransactions.openTransaction', { hash: item.hash })" :title="item.hash"><code>{{ short(item.hash) }}</code><AppIcon name="ExternalLink" :size="12" /></a></div></div>
          <div class="onchain-transaction-amount" :class="{ sent: item.direction === 'sent', failed: item.status === 'failed' }" :title="`${item.amount} ${item.symbol}`"><strong>{{ signedAmount(item) }}</strong><span :title="item.tokenAddress || undefined">{{ item.symbol }}</span></div>
        </li>
      </ul>
      <div class="transactions-footer"><span>{{ t('walletTransactions.recent', { count: history.transactions.length, limit: history.limit }) }}</span><span>{{ t('walletTransactions.timezone') }}</span><button v-if="filtered.length > visibleLimit" class="text-action" @click="visibleLimit += 10">{{ t('walletTransactions.showMore') }}<AppIcon name="ChevronDown" :size="14" /></button></div>
    </template>
  </section>
</template>

<style scoped>
.wallet-transactions { margin-top: 22px; min-width: 0; }
.transactions-header { gap: 18px; flex-wrap: wrap; padding-bottom: 20px; }
.transactions-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.transactions-actions .text-action { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; }
.transactions-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 24px 18px; }
.transactions-toolbar .search-field { flex: 1; min-width: 0; width: 100%; max-width: 420px; }
.transactions-toolbar .search-field input { min-width: 0; width: 100%; font-size: 12px; }
.transactions-toolbar .app-dropdown { flex-shrink: 0; min-width: 150px; }
.transactions-state { padding: 34px 24px; text-align: center; color: var(--text-secondary); }
.transactions-state > svg { margin-inline: auto; }
.transactions-state h3 { font-size: 14px; font-weight: 650; color: var(--text-primary); }
.transactions-state p { margin: 9px auto 18px; max-width: 480px; font-size: 12px; line-height: 1.8; }
.transactions-state .button { justify-content: center; }
.transactions-list { margin: 0; padding: 0 24px; list-style: none; }
.onchain-transaction { display: flex; align-items: center; gap: 14px; padding: 18px 0; border-top: 1px solid var(--border); }
.onchain-transaction-icon { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; flex-shrink: 0; color: var(--success, #30836b); background: var(--surface-alt); }
.onchain-transaction-icon.sent { color: var(--gold-text); background: var(--gold-soft); }
.onchain-transaction-icon.failed { color: var(--danger); }
.onchain-transaction-info { min-width: 0; flex: 1; }
.onchain-transaction-label { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.onchain-transaction-label > strong { color: var(--text-primary); font-size: 12px; font-weight: 650; }
.onchain-status { font-size: 9px; padding: 3px 6px; border-radius: 5px; background: var(--surface-alt); color: var(--text-secondary); }
.onchain-status.failed { color: var(--danger); }
.onchain-counterparty { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); margin-top: 6px; font-size: 10px; }
.onchain-transaction-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; color: var(--text-secondary); margin-top: 5px; font-size: 10px; line-height: 1.7; }
.onchain-transaction-meta a { display: inline-flex; align-items: center; gap: 4px; color: var(--gold-text); }
.onchain-transaction-amount { min-width: 0; max-width: 42%; text-align: right; color: var(--success, #30836b); }
.onchain-transaction-amount.sent { color: var(--text-primary); }
.onchain-transaction-amount.failed { color: var(--text-secondary); }
.onchain-transaction-amount strong { display: block; font-size: 14px; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.onchain-transaction-amount > span { display: block; color: var(--text-secondary); font-size: 10px; margin-top: 4px; overflow-wrap: anywhere; }
.transactions-footer { display: flex; justify-content: space-between; flex-wrap: wrap; align-items: center; gap: 10px; border-top: 1px solid var(--border); padding: 16px 24px; color: var(--text-secondary); font-size: 10px; line-height: 1.7; }
@media (max-width: 540px) {
  .transactions-toolbar { flex-direction: column; align-items: stretch; padding-inline: 18px; }
  .transactions-toolbar .search-field { max-width: none; }
  .transactions-list { padding-inline: 18px; }
  .onchain-transaction { gap: 10px; }
  .onchain-transaction-icon { width: 30px; height: 30px; border-radius: 9px; }
  .onchain-transaction-label { gap: 5px; }
  .onchain-transaction-amount { max-width: 38%; }
  .onchain-transaction-amount strong { font-size: 12px; }
  .onchain-transaction-meta { gap: 4px; flex-direction: column; align-items: flex-start; }
  .transactions-footer { padding-inline: 18px; }
}
</style>
