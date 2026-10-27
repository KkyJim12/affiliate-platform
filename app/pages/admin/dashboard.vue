<script setup lang="ts">
import type { AdminOverview } from "../../../shared/admin";
definePageMeta({ layout: "admin", middleware: "admin" });
const { t, formatDate } = useLoopI18n();
const { user } = useAccount();
const root = ref<HTMLElement | null>(null);
usePageMotion(root);
const { data, error, status, refresh } = await useFetch<AdminOverview>("/api/admin/overview");
const maxGrowth = computed(() => Math.max(1, ...data.value?.growth.map(day => day.accounts) || []));
useHead({ title: computed(() => `${t('admin.dashboard')} · UNXO`) });
</script>
<template>
  <main ref="root" class="admin-content">
    <div class="admin-page-heading"><div><span class="admin-eyebrow">{{ t('admin.welcome', { memberId: user?.memberId }) }}</span><h1>{{ t('admin.overviewTitle') }}</h1><p>{{ t('admin.overviewSubtitle') }}</p></div><button class="button button-outline button-small" :disabled="status === 'pending'" @click="refresh()"><AppIcon name="RefreshCw" :size="15" />{{ t('admin.refresh') }}</button></div>
    <div v-if="error" class="admin-load-error" role="alert">{{ t('admin.loadError') }}<button class="admin-text-button" @click="refresh()">{{ t('admin.retry') }}</button></div>
    <template v-if="data">
      <section class="admin-stat-grid admin-account-stats"><article class="admin-stat"><div><span>{{ t('admin.totalAccounts') }}</span><AppIcon name="Users" :size="19" /></div><strong>{{ data.accounts.toLocaleString() }}</strong><small>{{ t('admin.liveData') }}</small></article><article class="admin-stat"><div><span>{{ t('admin.activeAccountCount') }}</span><AppIcon name="ShieldCheck" :size="19" /></div><strong>{{ data.active.toLocaleString() }}</strong><small>{{ t('admin.activeAccountHint') }}</small></article></section>
      <div class="admin-overview-grid"><section class="admin-panel admin-growth"><div class="admin-panel-heading"><div><h2>{{ t('admin.accountGrowth') }}</h2><p>{{ t('admin.last7Days') }}</p></div><span class="admin-label">{{ t('admin.utc') }}</span></div><div class="admin-chart" role="img" :aria-label="t('admin.growthChart', { count: data.growth.reduce((sum, day) => sum + day.accounts, 0) })"><div v-for="day in data.growth" :key="day.day" class="admin-chart-column"><strong>{{ day.accounts }}</strong><div class="admin-chart-track"><span :style="{ height: Math.max(day.accounts ? 4 : 0, day.accounts / maxGrowth * 100) + '%' }"></span></div><span>{{ formatDate(day.day + 'T12:00:00Z', { weekday: 'short' }) }}</span></div></div></section><section class="admin-panel admin-quick-card"><span class="admin-quick-icon"><AppIcon name="Users" :size="26" /></span><h2>{{ t('admin.accountManagement') }}</h2><p>{{ t('admin.accountManagementHint') }}</p><NuxtLink to="/admin/users" class="button button-orange">{{ t('admin.manageUsers') }}<AppIcon name="ArrowRight" :size="16" /></NuxtLink><NuxtLink to="/admin/explorer" class="admin-text-button">{{ t('admin.explorer') }}<AppIcon name="ArrowUpRight" :size="15" /></NuxtLink></section></div>
      <section class="admin-panel"><div class="admin-panel-heading"><div><h2>{{ t('admin.activity') }}</h2><p>{{ t('admin.activityHint') }}</p></div><AppIcon name="ShieldCheck" :size="21" /></div><div class="admin-audit"><div v-for="item in data.audit" :key="item.id" class="admin-audit-item"><span class="admin-audit-icon"><AppIcon name="CheckCircle2" :size="17" /></span><div><strong>{{ t(`admin.audit.${item.action}`) }}</strong><span>ID {{ item.memberId }} · {{ item.target === 'platform' ? t('admin.platform') : item.target }}</span></div><time>{{ formatDate(item.createdAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</time></div><p v-if="!data.audit.length" class="admin-empty">{{ t('admin.noActivity') }}</p></div></section>
    </template>
  </main>
</template>

<style scoped>
.admin-account-stats { grid-template-columns: repeat(2,minmax(0,1fr)); }
@media(max-width:540px) { .admin-account-stats { grid-template-columns: 1fr; } }
</style>
