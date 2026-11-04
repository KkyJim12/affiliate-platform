<script setup lang="ts">
import type { AdminList, AdminMember } from "../../../shared/admin";
import { formatUsdt } from "#shared/plan";
definePageMeta({ layout: "admin", middleware: "admin" });
const { t, formatDate } = useLoopI18n();
const { errorMessage } = useAdminTools();
const { notify } = useAppUI();
const search = ref("");
const searchTerm = ref("");
const filter = ref("all");
const page = ref(1);
const selected = ref<AdminMember | null>(null);
const busy = ref(false);
const actionError = ref("");
const confirmingReferralCancellation = ref(false);
const root = ref<HTMLElement | null>(null);
usePageMotion(root);
const { data, error, status, refresh } = await useFetch<AdminList<AdminMember>>("/api/admin/users", { query: { search: searchTerm, status: filter, page } });
watch(filter, () => { page.value = 1; });
function searchUsers() { page.value = 1; searchTerm.value = search.value.trim(); }
function openUser(member: AdminMember) { selected.value = member; actionError.value = ""; confirmingReferralCancellation.value = false; }
async function cancelReferral() {
  if (!selected.value || busy.value) return;
  busy.value = true;
  actionError.value = "";
  try {
    await $fetch(`/api/admin/users/${selected.value.id}/sponsor`, { method: "DELETE" });
    selected.value = null;
    await refresh();
    notify(t("admin.referralCancelled"));
  } catch (failure) { actionError.value = errorMessage(failure); }
  finally { busy.value = false; }
}
async function changeStatus() {
  if (!selected.value || busy.value) return;
  busy.value = true;
  actionError.value = "";
  try {
    await $fetch(`/api/admin/users/${selected.value.id}`, { method: "PATCH", body: { status: selected.value.status === "active" ? "suspended" : "active" } });
    selected.value = null;
    await refresh();
    notify(t("admin.userUpdated"));
  } catch (failure) { actionError.value = errorMessage(failure); }
  finally { busy.value = false; }
}
useHead({ title: computed(() => `${t('admin.users')} · UNXO`) });
</script>
<template>
  <main ref="root" class="admin-content">
    <div class="admin-page-heading"><div><span class="admin-eyebrow">{{ t('admin.accountManagement') }}</span><h1>{{ t('admin.users') }}</h1><p>{{ t('admin.usersSubtitle') }}</p></div><span class="admin-count-badge"><AppIcon name="Users" :size="16" />{{ t('admin.results', { total: data?.total || 0 }) }}</span></div>
    <section class="admin-panel"><div class="admin-toolbar"><form class="admin-search" @submit.prevent="searchUsers"><label class="search-field"><AppIcon name="Search" :size="17" /><input v-model="search" :aria-label="t('admin.searchUsers')" :placeholder="t('admin.searchUsers')" maxlength="64" /></label><button class="button button-outline button-small" type="submit">{{ t('admin.search') }}</button></form><AppDropdown v-model="filter" :label="t('admin.filterUsers')" :options="[{ value: 'all', label: t('admin.allStatuses') }, { value: 'active', label: t('admin.status.active') }, { value: 'suspended', label: t('admin.status.suspended') }]" /></div>
      <div v-if="error" class="admin-load-error" role="alert">{{ t('admin.loadError') }}<button class="admin-text-button" @click="refresh()">{{ t('admin.retry') }}</button></div>
      <div class="admin-table-scroll" :aria-busy="status === 'pending'"><table class="admin-table"><thead><tr><th>{{ t('admin.member') }}</th><th>{{ t('ui.status') }}</th><th>{{ t('admin.balance') }}</th><th>{{ t('admin.referrals') }}</th><th>{{ t('admin.joined') }}</th><th><span class="sr-only">{{ t('admin.actions') }}</span></th></tr></thead><tbody><tr v-for="member in data?.items || []" :key="member.id"><td><div class="admin-table-identity"><span class="admin-table-avatar">{{ member.memberId ? member.memberId.slice(0, 2).toUpperCase() : '-' }}</span><div><strong>{{ member.memberId ? `ID ${member.memberId}` : t('admin.unpaidMember') }}</strong><small v-if="!member.memberId">{{ member.id }}</small><small v-else>{{ member.role === 'admin' ? t('admin.administrator') : member.referralCode || t('referral.notActivated') }}</small></div></div></td><td><span class="admin-status" :class="member.status"><i></i>{{ t(`admin.status.${member.status}`) }}</span></td><td class="admin-money">{{ formatUsdt(member.balance) }} <small>USDT</small></td><td>{{ member.referrals }}</td><td>{{ formatDate(member.createdAt) }}</td><td><button class="admin-text-button" @click="openUser(member)">{{ t('admin.manage') }}<AppIcon name="ArrowUpRight" :size="14" /></button></td></tr><tr v-if="data && !data.items.length"><td colspan="6"><div class="admin-empty"><AppIcon name="Users" :size="29" /><strong>{{ t('admin.noUsers') }}</strong><p>{{ t('admin.noUsersHint') }}</p></div></td></tr></tbody></table></div><AdminPagination v-if="data" :page="page" :total="data.total" :page-size="data.pageSize" @change="page = $event" /></section>
    <ModalTransition><AppModal v-if="selected" :title="t('admin.userDetails')" @close="!busy && (selected = null)"><div class="admin-dialog"><span class="admin-dialog-icon"><AppIcon name="Users" :size="25" /></span><h2>{{ t('admin.userDetails') }}</h2><p class="admin-account-id">ID {{ selected.memberId || selected.id }}</p><p v-if="actionError" class="auth-error" role="alert">{{ actionError }}</p><dl class="admin-details"><div><dt>{{ t('admin.role') }}</dt><dd>{{ selected.role === 'admin' ? t('admin.administrator') : t('admin.member') }}</dd></div><div><dt>{{ t('ui.status') }}</dt><dd>{{ t(`admin.status.${selected.status}`) }}</dd></div><div><dt>{{ t('admin.balance') }}</dt><dd>{{ formatUsdt(selected.balance) }} USDT</dd></div><div><dt>{{ t('admin.sponsor') }}</dt><dd>{{ selected.sponsor ? 'ID ' + selected.sponsor : '—' }}</dd></div><div><dt>{{ t('ui.invite_code') }}</dt><dd>{{ selected.referralCode || t('referral.notActivated') }}</dd></div><div><dt>{{ t('admin.referrals') }}</dt><dd>{{ selected.referrals }}</dd></div></dl>
      <section v-if="selected.sponsor" class="admin-referral-action" :aria-label="t('admin.cancelReferral')">
        <p class="admin-callout">{{ selected.hasPurchased ? t('admin.referralPurchasedHint') : selected.hasPendingPurchase ? t('admin.referralPendingHint') : t('admin.cancelReferralHint') }}</p>
        <template v-if="confirmingReferralCancellation">
          <p>{{ t('admin.cancelReferralConfirm', { code: selected.sponsor }) }}</p>
          <div class="admin-referral-buttons">
            <button class="button admin-danger-button" :disabled="busy" @click="cancelReferral">{{ busy ? t('ui.please_wait') : t('admin.confirmCancelReferral') }}</button>
            <button class="button button-outline" :disabled="busy" @click="confirmingReferralCancellation = false">{{ t('admin.keepReferral') }}</button>
          </div>
        </template>
        <button v-else class="button button-outline" :disabled="busy || selected.hasPurchased || selected.hasPendingPurchase" @click="confirmingReferralCancellation = true">{{ t('admin.cancelReferral') }}</button>
      </section>
      <p v-if="selected.role === 'admin'" class="admin-callout">{{ t('admin.adminProtected') }}</p><template v-else><p class="admin-callout">{{ selected.status === 'active' ? t('admin.suspensionHint') : t('admin.activationHint') }}</p><button class="button" :class="selected.status === 'active' ? 'admin-danger-button' : 'button-orange'" :disabled="busy" @click="changeStatus">{{ busy ? t('ui.please_wait') : selected.status === 'active' ? t('admin.suspendUser') : t('admin.activateUser') }}</button></template></div></AppModal></ModalTransition>
  </main>
</template>
