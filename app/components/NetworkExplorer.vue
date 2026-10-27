<script setup lang="ts">
import type { ExplorerNetwork } from "../../shared/explorer";
import type { ReferralNode } from "../../shared/types";
const props = defineProps<{ admin?: boolean; preview?: boolean; previewMembers?: ReferralNode[] }>();
const { t, formatDate } = useLoopI18n();
const { user } = useAccount();
const route = useRoute();
const search = ref("");
const rootSearch = ref(typeof route.query.memberId === "string" ? route.query.memberId : "");
const selectedId = ref("");
const query = computed(() => ({ root: typeof route.query.root === "string" ? route.query.root : undefined, memberId: props.admin && typeof route.query.memberId === "string" ? route.query.memberId : undefined }));
const { data, error, status, refresh } = await useFetch<ExplorerNetwork>(props.admin ? "/api/admin/explorer/network" : "/api/explorer/network", { query, immediate: !props.preview });
const network = computed<ExplorerNetwork | null>(() => props.preview ? { root: { id: "preview-root", memberId: "1000", joinedAt: "2026-10-17T12:00:00Z" }, members: props.previewMembers || [], truncated: false, remainingDepth: 15 } : data.value || null);
const matches = computed(() => network.value?.members.filter(member => member.memberId.toLowerCase().includes(search.value.trim().toLowerCase())) || []);
const selected = computed(() => {
  const current = network.value;
  if (!current) return null;
  return current.members.find(member => member.id === selectedId.value) || { ...current.root, depth: 0, parentId: "", status: "Registered" as const };
});
const inviter = computed(() => selected.value?.parentId === network.value?.root.id ? network.value?.root.memberId : network.value?.members.find(member => member.id === selected.value?.parentId)?.memberId);
const selectedChildren = computed(() => network.value?.members.filter(member => member.parentId === selected.value?.id).length || 0);
const isOwnRoot = computed(() => !route.query.root && !route.query.memberId || network.value?.root.id === user.value?.id);
watch(() => network.value?.root.id, id => { selectedId.value = id || ""; search.value = ""; }, { immediate: true });
async function changeRoot(id?: string, memberId?: string) {
  search.value = "";
  await navigateTo({ path: route.path, query: { ...route.query, root: id, memberId, tab: 'network' } }, { replace: true });
}
function findAccount() { const memberId = rootSearch.value.trim(); if (memberId) changeRoot(undefined, memberId); }
function resetRoot() { rootSearch.value = ""; changeRoot(); }
</script>
<template>
  <div class="explorer-network">
    <form v-if="admin" class="explorer-root-search" @submit.prevent="findAccount"><div><label for="explorer-account">{{ t('explorer.accountRoot') }}</label><p>{{ t('explorer.accountRootHint') }}</p></div><div class="explorer-root-input"><label class="search-field"><AppIcon name="Search" :size="17" /><input id="explorer-account" v-model="rootSearch" :placeholder="t('explorer.exactUsername')" maxlength="16" inputmode="numeric" pattern="[1-9][0-9]{0,15}" required autocomplete="off" /></label><button class="button button-orange button-small" type="submit">{{ t('explorer.openNetwork') }}<AppIcon name="ArrowRight" :size="15" /></button></div></form>
    <div v-if="!preview && status === 'pending'" class="explorer-loading" role="status"><AppIcon name="LoaderCircle" class="auth-loading" />{{ t('explorer.loading') }}</div>
    <div v-else-if="!preview && error" class="explorer-error" role="alert"><AppIcon name="Info" :size="21" /><div><strong>{{ t('explorer.networkUnavailable') }}</strong><p>{{ t('explorer.networkUnavailableHint') }}</p><button class="admin-text-button" @click="resetRoot">{{ t('explorer.myNetwork') }}</button><button class="admin-text-button" @click="refresh()">{{ t('admin.retry') }}</button></div></div>
    <template v-else-if="network">
      <div class="explorer-metrics"><article><span>{{ t('explorer.connections') }}</span><strong>{{ network.members.length }}<small v-if="network.truncated">+</small></strong><p>{{ t('explorer.inThisBranch') }}</p></article><article><span>{{ t('explorer.directConnections') }}</span><strong>{{ network.members.filter(member => member.depth === 1).length }}</strong><p>{{ t('explorer.invitedByRoot') }}</p></article><article><span>{{ t('explorer.networkDepth') }}</span><strong>{{ Math.max(0, ...network.members.map(member => member.depth)) }}<small>/ {{ network.remainingDepth }}</small></strong><p>{{ t('explorer.levelsInView') }}</p></article></div>
      <div class="explorer-network-grid"><section class="explorer-panel explorer-tree-panel"><div class="explorer-panel-heading"><div><span class="explorer-eyebrow">{{ t('explorer.networkRoot') }}</span><h2>{{ preview ? t('ui.you') : 'ID ' + network.root.memberId }}</h2><p>{{ t('explorer.treeHint') }}</p></div><button v-if="!isOwnRoot && !preview" class="admin-text-button" @click="resetRoot"><AppIcon name="ArrowLeft" :size="14" />{{ t('explorer.myNetwork') }}</button></div><div class="explorer-network-search"><label class="search-field"><AppIcon name="Search" :size="16" /><input v-model="search" :aria-label="t('explorer.searchNetwork')" :placeholder="t('explorer.searchNetwork')" maxlength="64" /></label><span>{{ t('explorer.matchCount', { count: matches.length }) }}</span></div><ReferralTree :key="network.root.id" :members="network.members" :root-id="network.root.id" :memberId="network.root.memberId" :root-label="t('explorer.networkRoot')" :matching-ids="matches.map(member => member.id)" :filtered="!!search.trim()" interactive :selected-id="selected?.id" @select="selectedId = $event" /><p v-if="network.truncated" class="explorer-limit-note">{{ t('explorer.nodeLimit') }}</p><p v-if="network.remainingDepth < 15" class="explorer-limit-note">{{ t('explorer.depthLimit', { count: network.remainingDepth }) }}</p></section>
        <aside v-if="selected" class="explorer-panel explorer-member-detail"><span class="explorer-detail-icon"><AppIcon name="Users" :size="23" /></span><span class="explorer-eyebrow">{{ t('explorer.selectedMember') }}</span><h2>{{ selected.memberId === 'You' && preview ? t('ui.you') : 'ID ' + selected.memberId }}</h2><span class="explorer-pill">{{ selected.depth === 0 ? t('explorer.networkRoot') : t('ui.level_p0', { p0: selected.depth }) }}</span><dl><div><dt>{{ t('admin.joined') }}</dt><dd>{{ formatDate(selected.joinedAt) }}</dd></div><div><dt>{{ t('admin.sponsor') }}</dt><dd>{{ inviter ? 'ID ' + inviter : '—' }}</dd></div><div><dt>{{ t('explorer.directConnections') }}</dt><dd>{{ selectedChildren }}</dd></div><div><dt>{{ t('ui.status') }}</dt><dd>{{ selected.status === 'Qualified' ? t('ui.qualified') : t('ui.registered') }}</dd></div></dl><button v-if="selected.depth > 0 && !preview" class="button button-orange" @click="changeRoot(selected.id)">{{ t('explorer.exploreBranch') }}<AppIcon name="ArrowUpRight" :size="15" /></button><p>{{ t('explorer.branchHint') }}</p></aside></div>
    </template>
  </div>
</template>
