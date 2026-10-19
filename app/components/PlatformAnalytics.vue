<script setup lang="ts">
import type { PlatformAnalytics } from "#shared/platform-activity";
import { formatUsdt } from "#shared/plan";
const { t, localeTag, formatDate } = useLoopI18n();
const { data, error, status, refresh } = await useFetch<PlatformAnalytics>("/api/platform/analytics");
const metric = ref<"purchases" | "volume" | "accounts">("purchases");
const maximum = computed(() => Math.max(1, ...(data.value?.daily || []).map(day => day[metric.value])));
const number = (value: number | undefined) => value === undefined ? "—" : new Intl.NumberFormat(localeTag.value).format(value);
const metrics = computed(() => [
  { key: "accounts", value: number(data.value?.accounts), icon: "Users" as const },
  { key: "activeMembers", value: number(data.value?.activeMembers), icon: "ShieldCheck" as const },
  { key: "buyers", value: number(data.value?.buyers), icon: "Wallet" as const },
  { key: "purchases", value: number(data.value?.purchases), icon: "Layers" as const },
]);
function dayLabel(day: string) { return formatDate(`${day}T05:00:00Z`, { month: "short", day: "numeric", timeZone: "Asia/Bangkok" }); }
</script>

<template>
  <div class="platform-analytics" data-testid="platform-analytics">
    <div class="analytics-toolbar"><p>{{ t('workspace.analyticsEvidence') }}</p><button class="button button-outline button-small" :disabled="status === 'pending'" @click="refresh()"><AppIcon name="RefreshCw" :size="15" />{{ t('admin.refresh') }}</button></div>
    <p v-if="error" class="auth-error" role="alert">{{ t('workspace.loadError') }}</p>
    <p v-if="data && !data.configured" class="analytics-note">{{ t('workspace.contractNotConfigured') }}</p>
    <div class="analytics-stat-grid"><article v-for="item in metrics" :key="item.key" class="panel analytics-stat"><AppIcon :name="item.icon" :size="21" /><span>{{ t(`workspace.${item.key}`) }}</span><strong :data-testid="`platform-${item.key}`">{{ item.value }}</strong></article></div>
    <div class="analytics-main-grid">
      <section class="panel analytics-chart"><div class="analytics-section-heading"><div><h2>{{ t('workspace.platformActivity') }}</h2><p>{{ t('workspace.last30Days') }}</p></div><AppDropdown v-model="metric" :label="t('workspace.chartMetric')" :options="['purchases', 'volume', 'accounts'].map(value => ({ value, label: t(`workspace.${value}`) }))" /></div>
        <svg viewBox="0 0 780 230" role="img" :aria-label="t('workspace.activityChart')" class="analytics-chart-svg">
          <line x1="20" y1="190" x2="760" y2="190" stroke="var(--border)" /><line x1="20" y1="105" x2="760" y2="105" stroke="var(--border)" stroke-dasharray="4 5" />
          <g v-for="(day, index) in data?.daily || []" :key="day.day"><rect :x="24 + index * 24.4" :y="190 - day[metric] / maximum * 160" width="15" :height="day[metric] / maximum * 160" rx="4" fill="var(--gold)"><title>{{ dayLabel(day.day) }} · {{ t(`workspace.${metric}`) }}: {{ metric === 'volume' ? formatUsdt(day.volume) : number(day[metric]) }}</title></rect></g>
          <text x="22" y="215" fill="var(--text-secondary)" font-size="12">{{ data?.daily[0] ? dayLabel(data.daily[0].day) : '' }}</text><text x="758" y="215" text-anchor="end" fill="var(--text-secondary)" font-size="12">{{ data?.daily[29] ? dayLabel(data.daily[29].day) : '' }}</text>
        </svg>
      </section>
      <section class="panel analytics-volume"><AppIcon name="CircleDollarSign" :size="25" /><span>{{ t('workspace.confirmedVolume') }}</span><strong data-testid="platform-volume">{{ data ? formatUsdt(data.volume) : '—' }} <small>USDT</small></strong><p>{{ t('workspace.testnetUnits') }}</p><div><span>{{ t('workspace.confirmedTransactions') }}</span><b>{{ number(data?.transactions) }}</b></div><NuxtLink to="/explorer" class="inline-link">{{ t('workspace.viewContractTransactions') }}<AppIcon name="ArrowUpRight" :size="15" /></NuxtLink></section>
    </div>
    <section class="panel analytics-distributions"><div class="analytics-section-heading"><div><h2>{{ t('workspace.recordedDistributions') }}</h2><p>{{ t('workspace.distributionEvidence') }}</p></div></div><div class="analytics-share-grid"><article v-for="kind in (['direct', 'bonus', 'platform'] as const)" :key="kind"><span>{{ t(`workspace.share_${kind}`) }}</span><strong>{{ data ? formatUsdt(data.distributions[kind]) : '—' }} <small>USDT</small></strong></article></div></section>
    <section class="panel"><div class="analytics-section-heading"><div><h2>{{ t('workspace.levelActivity') }}</h2><p>{{ t('workspace.confirmedOnly') }}</p></div></div><div class="explorer-table-scroll"><table class="explorer-table"><thead><tr><th>{{ t('ui.level') }}</th><th>{{ t('workspace.purchases') }}</th><th>{{ t('workspace.volume') }}</th></tr></thead><tbody><tr v-for="level in data?.levels || []" :key="level.level"><td>{{ t('ui.level') }} {{ level.level }}</td><td>{{ number(level.purchases) }}</td><td>{{ formatUsdt(level.volume) }} USDT</td></tr></tbody></table></div></section>
    <p v-if="data" class="analytics-updated">{{ t('workspace.updatedAt', { time: formatDate(data.updatedAt, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) }) }}</p>
  </div>
</template>

<style scoped>
.platform-analytics { display: grid; gap: 22px; min-width: 0; }
.analytics-toolbar, .analytics-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.analytics-toolbar p, .analytics-section-heading p, .analytics-note, .analytics-updated { color: var(--text-secondary); font-size: 12px; line-height: 1.8; }
.analytics-toolbar p { max-width: 760px; }
.analytics-stat-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 18px; }
.analytics-stat { padding: 23px; display: grid; gap: 13px; }
.analytics-stat svg, .analytics-volume > svg { color: var(--gold-text); }
.analytics-stat > span, .analytics-volume > span { font-size: 12px; color: var(--text-secondary); }
.analytics-stat strong { font: 650 30px var(--heading); color: var(--text-primary); }
.analytics-main-grid { display: grid; grid-template-columns: minmax(0,2fr) minmax(0,1fr); gap: 22px; }
.analytics-section-heading { padding: 23px; }
.analytics-section-heading h2 { font-size: 15px; font-weight: 650; }
.analytics-chart-svg { display: block; width: 100%; padding: 0 15px 16px; }
.analytics-volume { display: flex; flex-direction: column; gap: 17px; padding: 24px; }
.analytics-volume > strong { font: 650 clamp(24px,3vw,34px) var(--heading); overflow-wrap: anywhere; }
.analytics-volume small, .analytics-share-grid small { font: 500 11px var(--font); }
.analytics-volume > p { font-size: 11px; color: var(--text-secondary); line-height: 1.7; }
.analytics-volume > div { display: flex; justify-content: space-between; gap: 12px; padding-top: 18px; border-top: 1px solid var(--border); font-size: 12px; }
.analytics-share-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 20px; padding: 0 23px 25px; }
.analytics-share-grid article { display: grid; gap: 12px; }
.analytics-share-grid span { color: var(--text-secondary); font-size: 12px; }
.analytics-share-grid strong { font-size: 24px; overflow-wrap: anywhere; }
.analytics-updated { text-align: right; }
@media(max-width:800px) { .analytics-stat-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } .analytics-main-grid { grid-template-columns: 1fr; } }
@media(max-width:480px) { .analytics-stat { padding: 17px; } .analytics-share-grid { grid-template-columns: 1fr; } }
</style>
