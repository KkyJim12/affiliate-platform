<script setup lang="ts">
import type { PlatformActivity, PlatformTransaction } from "#shared/platform-activity";
import { formatUsdt } from "#shared/plan";
const { t, formatDate } = useLoopI18n();
const route = useRoute();
const search = ref(String(route.query.q || ""));
const selected = ref<PlatformTransaction | null>(null);
function change(values: Record<string, string | undefined>) {
  return navigateTo({ path: route.path, query: { ...route.query, ...values, tab: "transactions" } }, { replace: true });
}
const kind = computed({ get: () => ["purchase", "fee_update"].includes(String(route.query.kind)) ? String(route.query.kind) : "all", set: value => { change({ kind: value === "all" ? undefined : value, page: undefined }); } });
const state = computed({ get: () => ["pending", "confirmed", "failed"].includes(String(route.query.status)) ? String(route.query.status) : "all", set: value => { change({ status: value === "all" ? undefined : value, page: undefined }); } });
const period = computed({ get: () => ["7", "30", "90"].includes(String(route.query.period)) ? String(route.query.period) : "all", set: value => { change({ period: value === "all" ? undefined : value, page: undefined }); } });
const page = computed(() => Math.max(1, Number.parseInt(String(route.query.page || 1), 10) || 1));
const query = computed(() => ({ kind: kind.value, status: state.value, period: period.value, page: page.value, search: String(route.query.q || "") }));
const { data, error, status, refresh } = await useFetch<PlatformActivity>("/api/platform/transactions", { query });
watch(() => route.query.q, value => { search.value = String(value || ""); });
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
function clear() { search.value = ""; change({ q: undefined, status: undefined, kind: undefined, period: undefined, page: undefined }); }
</script>

<template>
  <div class="contract-explorer" data-testid="contract-explorer">
    <p class="explorer-ledger-note"><AppIcon name="ShieldCheck" :size="18" />{{ t('workspace.contractEvidence') }}</p>
    <div class="explorer-metrics">
      <article><span>{{ t('workspace.confirmedTransactions') }}</span><strong>{{ data?.summary.confirmed ?? '—' }}</strong><p>{{ t('explorer.filteredTotals') }}</p></article>
      <article><span>{{ t('workspace.confirmedVolume') }}</span><strong>{{ data ? formatUsdt(data.summary.volume) : '—' }} <small>USDT</small></strong><p>{{ t('workspace.testnetUnits') }}</p></article>
      <article><span>{{ t('connected.pending') }}</span><strong>{{ data?.summary.pending ?? '—' }}</strong><p>{{ t('workspace.pendingEvidence') }}</p></article>
    </div>
    <section class="explorer-panel">
      <div class="explorer-panel-heading"><div><span class="explorer-eyebrow">Polygon Amoy · 80002</span><h2>{{ t('workspace.contractTransactions') }}</h2><p v-if="data?.contractAddress" class="contract-address">{{ data.contractAddress }}</p></div><button class="admin-text-button" :disabled="status === 'pending'" @click="refresh()"><AppIcon name="RefreshCw" :size="15" />{{ t('admin.refresh') }}</button></div>
      <div class="explorer-transaction-controls">
        <form class="explorer-record-search" @submit.prevent="change({ q: search.trim() || undefined, page: undefined })"><label class="search-field"><AppIcon name="Search" :size="16" /><input v-model="search" :aria-label="t('workspace.searchContract')" :placeholder="t('workspace.searchContract')" maxlength="100" /></label><button class="button button-outline button-small">{{ t('admin.search') }}</button></form>
        <div class="explorer-transaction-filters">
          <AppDropdown v-model="kind" :label="t('explorer.filterType')" :options="[{ value: 'all', label: t('explorer.allTypes') }, ...['purchase', 'fee_update'].map(value => ({ value, label: t(`workspace.${value}`) }))]" />
          <AppDropdown v-model="state" :label="t('explorer.filterStatus')" :options="[{ value: 'all', label: t('admin.allStatuses') }, ...['pending', 'confirmed', 'failed'].map(value => ({ value, label: t(`connected.${value}`) }))]" />
          <AppDropdown v-model="period" :label="t('explorer.filterPeriod')" :options="[{ value: 'all', label: t('explorer.allTime') }, ...['7', '30', '90'].map(value => ({ value, label: t('explorer.lastDays', { count: value }) }))]" />
          <button class="admin-text-button" @click="clear">{{ t('explorer.clearFilters') }}</button>
        </div>
      </div>
      <div v-if="error" class="explorer-error" role="alert">{{ t('workspace.loadError') }}<button class="admin-text-button" @click="refresh()">{{ t('admin.retry') }}</button></div>
      <p v-else-if="data && !data.configured" class="platform-empty">{{ t('workspace.contractNotConfigured') }}</p>
      <div v-else class="explorer-table-scroll" :aria-busy="status === 'pending'">
        <table class="explorer-table"><thead><tr><th>{{ t('explorer.transaction') }}</th><th>{{ t('explorer.type') }}</th><th>{{ t('workspace.sender') }}</th><th>{{ t('admin.amount') }}</th><th>{{ t('ui.status') }}</th><th>{{ t('explorer.date') }}</th><th><span class="sr-only">{{ t('admin.details') }}</span></th></tr></thead>
          <tbody><tr v-for="item in data?.items || []" :key="item.hash"><td><a :href="item.explorerUrl" target="_blank" rel="noopener noreferrer" class="contract-hash"><code>{{ short(item.hash) }}</code><AppIcon name="ExternalLink" :size="13" /></a></td><td>{{ t(`workspace.${item.kind}`) }}<small v-if="item.level"> · {{ t('ui.level') }} {{ item.level }}</small></td><td><code :title="item.from">{{ short(item.from) }}</code></td><td>{{ item.kind === 'purchase' ? formatUsdt(item.amount) + ' USDT' : '—' }}</td><td><span class="admin-status" :class="item.status"><i></i>{{ t(`connected.${item.status}`) }}</span></td><td>{{ formatDate(item.createdAt) }}</td><td><button class="admin-text-button" @click="selected = item">{{ t('admin.details') }}</button></td></tr>
            <tr v-if="!data?.items.length"><td colspan="7"><div class="explorer-empty"><AppIcon :name="status === 'pending' ? 'LoaderCircle' : 'List'" :size="26" /><strong>{{ status === 'pending' ? t('explorer.loading') : t('workspace.noContractTransactions') }}</strong><p>{{ t('workspace.emptyContractHint') }}</p></div></td></tr>
          </tbody>
        </table>
      </div>
      <AdminPagination v-if="data && !error" :page="data.page" :total="data.total" :page-size="data.pageSize" @change="change({ page: String($event) })" />
    </section>
    <ModalTransition><AppModal v-if="selected" :title="t('explorer.transactionDetails')" @close="selected = null"><div class="admin-dialog"><h2>{{ t('explorer.transactionDetails') }}</h2><dl class="admin-details">
      <div><dt>{{ t('explorer.transactionId') }}</dt><dd class="admin-wrap-value">{{ selected.hash }}</dd></div><div><dt>{{ t('workspace.sender') }}</dt><dd class="admin-wrap-value">{{ selected.from }}</dd></div><div><dt>{{ t('workspace.contract') }}</dt><dd class="admin-wrap-value">{{ selected.to }}</dd></div><div v-if="selected.recipient"><dt>{{ t('evmSend.recipient') }}</dt><dd class="admin-wrap-value">{{ selected.recipient }}</dd></div><div v-if="selected.blockNumber !== null"><dt>{{ t('workspace.block') }}</dt><dd>{{ selected.blockNumber }}</dd></div><div><dt>{{ t('ui.status') }}</dt><dd>{{ t(`connected.${selected.status}`) }}</dd></div></dl><a class="button button-outline" :href="selected.explorerUrl" target="_blank" rel="noopener noreferrer">{{ t('onchain.viewTransaction') }}<AppIcon name="ExternalLink" :size="15" /></a></div></AppModal></ModalTransition>
  </div>
</template>

<style scoped>
.contract-explorer { display: grid; gap: 22px; min-width: 0; }
.contract-address { overflow-wrap: anywhere; font-family: monospace; }
.contract-hash { display: inline-flex; align-items: center; gap: 7px; color: var(--gold-text); }
.explorer-ledger-note { display: flex; align-items: flex-start; gap: 10px; }
.platform-empty { padding: 30px; color: var(--text-secondary); line-height: 1.8; }
</style>
