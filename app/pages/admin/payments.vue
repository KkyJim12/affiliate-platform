<script setup lang="ts">
import type { AdminList, AdminPayment } from "../../../shared/admin";
definePageMeta({ layout: "admin", middleware: "admin", alias: ["/admin/payment"] });
const { t } = useLoopI18n();
const route = useRoute();
const search = ref("");
const searchTerm = ref("");
const filter = ref(["pending", "completed", "rejected"].includes(String(route.query.status)) ? String(route.query.status) : "all");
const page = ref(1);
const selected = ref<AdminPayment | null>(null);
const root = ref<HTMLElement | null>(null);
usePageMotion(root);
const { data, error, status, refresh } = await useFetch<AdminList<AdminPayment>>("/api/admin/payments", { query: { search: searchTerm, status: filter, page } });
watch(filter, () => { page.value = 1; });
watch(data, value => { if (route.query.request && !selected.value) selected.value = value?.items.find(item => item.id === route.query.request) || null; }, { immediate: true });
function searchPayments() { page.value = 1; searchTerm.value = search.value.trim(); }
async function closeReview() { selected.value = null; if (route.query.request) await navigateTo({ path: route.path, query: { ...route.query, request: undefined } }, { replace: true }); }
async function reviewed() { await closeReview(); await refresh(); }
useHead({ title: computed(() => `${t('admin.payments')} · UNXO`) });
</script>
<template>
  <main ref="root" class="admin-content">
    <div class="admin-page-heading"><div><span class="admin-eyebrow">{{ t('admin.paymentOperations') }}</span><h1>{{ t('admin.payments') }}</h1><p>{{ t('admin.paymentsSubtitle') }}</p></div><button class="button button-outline button-small" :disabled="status === 'pending'" @click="refresh()"><AppIcon name="RefreshCw" :size="15" />{{ t('admin.refresh') }}</button></div>
    <div class="admin-info-strip"><AppIcon name="ShieldCheck" :size="19" /><p>{{ t('admin.settlementHint') }}</p></div>
    <section class="admin-panel"><div class="admin-toolbar"><form class="admin-search" @submit.prevent="searchPayments"><label class="search-field"><AppIcon name="Search" :size="17" /><input v-model="search" :aria-label="t('admin.searchPayments')" :placeholder="t('admin.searchPayments')" maxlength="64" /></label><button class="button button-outline button-small" type="submit">{{ t('admin.search') }}</button></form><AppDropdown v-model="filter" :label="t('admin.filterPayments')" :options="[{ value: 'all', label: t('admin.allStatuses') }, { value: 'pending', label: t('admin.status.pending') }, { value: 'completed', label: t('admin.status.completed') }, { value: 'rejected', label: t('admin.status.rejected') }]" /></div><div v-if="error" class="admin-load-error" role="alert">{{ t('admin.loadError') }}<button class="admin-text-button" @click="refresh()">{{ t('admin.retry') }}</button></div><div :aria-busy="status === 'pending'"><AdminPaymentTable :items="data?.items || []" @review="selected = $event" /></div><AdminPagination v-if="data" :page="page" :total="data.total" :page-size="data.pageSize" @change="page = $event" /></section>
    <AdminPaymentReview v-if="selected" :payment="selected" @close="closeReview" @reviewed="reviewed" />
  </main>
</template>
