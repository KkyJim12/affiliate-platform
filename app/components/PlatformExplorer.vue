<script setup lang="ts">
import type { ReferralNode } from "../../shared/types";
defineProps<{ admin?: boolean; preview?: boolean; previewMembers?: ReferralNode[] }>();
const { t } = useLoopI18n();
const route = useRoute();
const tab = computed(() => route.query.tab === "network" ? "network" : "transactions");
const tabs = ref<HTMLElement | null>(null);
async function chooseTab(value: string, focus = false) {
  await navigateTo({ path: route.path, query: { ...route.query, tab: value === "transactions" ? undefined : value } }, { replace: true });
  if (focus) { await nextTick(); tabs.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true }); }
}
function onKey(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  chooseTab(event.key === "Home" ? "network" : event.key === "End" ? "transactions" : tab.value === "network" ? "transactions" : "network", true);
}
</script>
<template>
  <div class="platform-explorer">
    <div class="explorer-section-bar"><div ref="tabs" class="explorer-tabs" role="tablist" :aria-label="t('explorer.sections')" @keydown="onKey"><button v-for="item in [{ key: 'network', icon: 'GitFork' as const }, { key: 'transactions', icon: 'List' as const }]" :id="`explorer-tab-${item.key}`" :key="item.key" type="button" role="tab" :aria-selected="tab === item.key" :aria-controls="`explorer-panel-${item.key}`" :tabindex="tab === item.key ? 0 : -1" :class="{ selected: tab === item.key }" @click="chooseTab(item.key)"><AppIcon :name="item.icon" :size="17" />{{ t(`explorer.${item.key}`) }}</button></div><span class="explorer-scope"><AppIcon :name="preview ? 'Eye' : admin ? 'Globe' : 'ShieldCheck'" :size="14" />{{ t(tab === 'transactions' ? 'workspace.contractScope' : preview ? 'explorer.previewScope' : admin ? 'explorer.adminScope' : 'explorer.memberScope') }}</span></div>
    <section :id="`explorer-panel-${tab}`" role="tabpanel" :aria-labelledby="`explorer-tab-${tab}`"><NetworkExplorer v-if="tab === 'network'" :admin="admin" :preview="preview" :preview-members="previewMembers" /><ContractExplorer v-else /></section>
  </div>
</template>
