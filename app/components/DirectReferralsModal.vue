<script setup lang="ts">
import type { ReferralMember } from "#shared/types";

const props = defineProps<{ open: boolean; members: ReferralMember[]; loading: boolean; error: string }>();
const emit = defineEmits<{ close: []; tree: []; retry: [] }>();
const { t, tr, localeTag, formatDate } = useLoopI18n();
const search = ref(''), page = ref(1), pageSize = 20;
const matches = computed(() => props.members.filter(member => member.memberId.includes(search.value.trim())));
const pages = computed(() => Math.max(1, Math.ceil(matches.value.length / pageSize)));
const visible = computed(() => matches.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const number = (value: number) => value.toLocaleString(localeTag.value);
watch([search, () => props.members], () => { page.value = 1; });
watch(() => props.open, () => { search.value = ''; page.value = 1; });
</script>

<template>
  <ModalTransition><AppModal v-if="open" :title="t('dashboard.directReferrals')" @close="emit('close')">
    <div class="direct-referrals-modal" data-testid="direct-referrals-modal">
      <span class="eyebrow">{{ t('directReferrals.personalInvites') }}</span>
      <h2>{{ t('dashboard.directReferrals') }}</h2>
      <p>{{ t('directReferrals.listHint') }}</p>
      <div class="direct-referrals-heading">
        <strong>{{ t('directReferrals.count', { count: number(members.length) }) }}</strong>
        <button class="button button-outline button-small" @click="emit('tree')"><AppIcon name="GitFork" :size="15" />{{ t('directReferrals.viewTree') }}</button>
      </div>
      <label class="search-field direct-referrals-search"><AppIcon name="Search" :size="17" /><input v-model="search" :aria-label="t('directReferrals.search')" :placeholder="t('directReferrals.search')" inputmode="numeric" maxlength="16" /></label>
      <p v-if="loading" class="direct-referrals-message" role="status">{{ t('ui.please_wait') }}</p>
      <div v-else-if="error" class="direct-referrals-message" role="alert"><p>{{ tr(error) }}</p><button class="button button-outline button-small" @click="emit('retry')">{{ t('admin.refresh') }}</button></div>
      <template v-else>
        <div class="direct-referrals-list" tabindex="0" role="region" :aria-label="t('directReferrals.memberList')">
          <table v-if="visible.length"><thead><tr><th>{{ t('publicTree.memberId') }}</th><th>{{ t('admin.joined') }}</th></tr></thead>
            <tbody><tr v-for="member in visible" :key="member.memberId" data-testid="direct-referral-row"><td><strong>ID {{ member.memberId }}</strong></td><td>{{ formatDate(member.joinedAt) }}</td></tr></tbody>
          </table>
          <p v-else class="direct-referrals-message">{{ t(search.trim() ? 'directReferrals.noMatches' : 'directReferrals.empty') }}</p>
        </div>
        <nav v-if="pages > 1" class="direct-referrals-pagination" :aria-label="t('directReferrals.pagination')">
          <button class="button button-outline button-small" :disabled="page <= 1" @click="page--">{{ t('matrixSlots.previous') }}</button>
          <span>{{ t('matrixSlots.page', { page: number(page), pages: number(pages) }) }}</span>
          <button class="button button-outline button-small" :disabled="page >= pages" @click="page++">{{ t('matrixSlots.next') }}</button>
        </nav>
      </template>
    </div>
  </AppModal></ModalTransition>
</template>

<style scoped>
.direct-referrals-modal { min-width: 0; padding-top: 5px; }
.direct-referrals-modal h2 { margin: 10px 30px 8px 0; font-size: 24px; line-height: 1.4; }
.direct-referrals-modal > p { color: var(--text-secondary); font-size: 13px; line-height: 1.8; }
.direct-referrals-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin: 22px 0 16px; }
.direct-referrals-heading > strong { font-size: 13px; }
.direct-referrals-search { width: 100%; min-width: 0; margin-bottom: 16px; }
.direct-referrals-search input { min-width: 0; width: 100%; }
.direct-referrals-list { max-height: 45vh; overflow: auto; border: 1px solid var(--border); border-radius: 12px; }
.direct-referrals-list table { width: 100%; border-collapse: collapse; font-size: 12px; }
.direct-referrals-list th, .direct-referrals-list td { padding: 13px 16px; text-align: left; border-bottom: 1px solid var(--border); }
.direct-referrals-list th { position: sticky; top: 0; background: var(--surface-alt); color: var(--text-secondary); font-size: 11px; }
.direct-referrals-list tr:last-child td { border-bottom: 0; }
.direct-referrals-list td:last-child { color: var(--text-secondary); }
.direct-referrals-pagination { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-top: 16px; font-size: 11px; color: var(--text-secondary); }
.direct-referrals-message { padding: 24px 12px; text-align: center; font-size: 13px; line-height: 1.8; color: var(--text-secondary); }
.direct-referrals-message button { margin-top: 12px; }
</style>
