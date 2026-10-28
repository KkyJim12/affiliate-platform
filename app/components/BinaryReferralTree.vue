<script setup lang="ts">
import { layoutReferralTree, referralTreeCard, referralTreeDepth, treeParentPath, treePathDepth, treePathSlots, type ReferralTreeData } from "#shared/referral-tree";

const props = defineProps<{ memberId: string }>();
const { t, localeTag } = useLoopI18n();
const branch = ref("");
const levels = ref(3);
const mode = ref<"matrix" | "unilevel">("matrix");
const programLevel = ref(1), cycle = ref(0);
const maxDepth = computed(() => mode.value === "matrix" ? 3 : 15);
const zoom = ref(100);
const viewport = ref<HTMLElement | null>(null);
const scrollLeft = ref(0);
const viewportWidth = ref(1000);
let focusedLevel: number | undefined;
const requestKey = useId();
const { data: tree, status, error, refresh } = await useFetch<ReferralTreeData>("/api/referrals/tree", {
  key: `binary-tree-${requestKey}`,
  query: { id: computed(() => props.memberId), path: branch, levels, mode, level: programLevel, cycle },
});
watch([() => props.memberId, mode, programLevel], () => { branch.value = ""; cycle.value = 0; levels.value = 3; }, { flush: "sync" });
watch(cycle, () => { branch.value = ""; }, { flush: "sync" });
const failed = computed(() => error.value?.statusCode === 404 ? t('publicTree.notFound') : t('publicTree.loadError'));
const { width: cardWidth, height: cardHeight, rowHeight } = referralTreeCard;
const branchDepth = computed(() => treePathDepth(tree.value?.path ?? branch.value));
const layout = computed(() => {
  if (!tree.value) return { nodes: [], width: 800, height: 440 };
  const left = scrollLeft.value * 100 / zoom.value;
  const right = (scrollLeft.value + viewportWidth.value) * 100 / zoom.value;
  return layoutReferralTree(tree.value, left, right);
});
function updateViewport() {
  if (!viewport.value) return;
  scrollLeft.value = viewport.value.scrollLeft;
  viewportWidth.value = viewport.value.clientWidth;
}
watch(viewport, (element, _, onCleanup) => {
  if (!element) return;
  const observer = new ResizeObserver(updateViewport);
  observer.observe(element);
  onCleanup(() => observer.disconnect());
  updateViewport();
});
function centerTree() {
  nextTick(() => {
    if (!viewport.value) return;
    viewport.value.scrollLeft = (layout.value.width * zoom.value / 100 - viewport.value.clientWidth) / 2;
    viewport.value.scrollTop = focusedLevel === undefined ? 0 : Math.max(0, focusedLevel - branchDepth.value) * rowHeight * zoom.value / 100;
    focusedLevel = undefined;
    updateViewport();
  });
}
watch([tree, zoom], centerTree);
onMounted(centerTree);
function explore(path: string) {
  if (treePathDepth(path) <= maxDepth.value && path !== branch.value) branch.value = path;
}
function showLevel(depth: number) {
  const start = Math.max(0, depth - levels.value);
  const slots = treePathSlots(branch.value).slice(0, start);
  while (slots.length < start) slots.push('0');
  const path = slots.join('/');
  focusedLevel = depth;
  if (path === branch.value) centerTree();
  else explore(path);
}
const number = (value: number) => value.toLocaleString(localeTag.value);
</script>

<template>
  <section class="binary-referral-tree" :aria-label="t('publicTree.treeLabel')" :aria-busy="status === 'pending'" data-testid="binary-referral-tree">
    <div class="binary-tree-toolbar">
      <div role="group" :aria-label="t('matrix.program')" class="binary-tree-options">
        <button class="button button-outline button-small" :aria-pressed="mode === 'matrix'" @click="mode = 'matrix'">{{ t('matrix.binary') }}</button>
        <button class="button button-outline button-small" :aria-pressed="mode === 'unilevel'" @click="mode = 'unilevel'">{{ t('matrix.unilevel') }}</button>
      </div>
      <div v-if="mode === 'matrix'" class="binary-tree-options">
        <AppDropdown v-model="programLevel" :label="t('ranksPage.selectLevel')" compact :options="Array.from({ length: 15 }, (_,index) => ({ value: index + 1,label: t('ranksPage.level') + ' ' + (index + 1) }))" />
        <AppDropdown v-if="(tree?.cycles?.length ?? 0) > 1" v-model="cycle" :label="t('matrix.slot')" compact :options="(tree?.cycles ?? []).map(value => ({ value,label: t('matrix.slotNumber', { number: value + 1 }) }))" />
      </div>
    </div>
    <p class="binary-tree-note">{{ t(mode === 'matrix' ? 'matrix.treeHint' : 'matrix.unilevelHint') }}</p>
    <div v-if="error" class="binary-tree-message" role="alert"><AppIcon name="Search" :size="28" /><p>{{ failed }}</p><button class="button button-outline button-small" @click="refresh()">{{ t('publicTree.retry') }}</button></div>
    <template v-else-if="tree">
      <div class="binary-tree-header">
        <div>
          <span class="eyebrow">{{ t('publicTree.structure') }}</span>
          <h2>{{ t('publicTree.memberTitle', { id: tree.root.id }) }}</h2>
          <p>{{ t('publicTree.exploreHint') }}</p>
        </div>
        <span class="outline-pill">{{ t('publicTree.level', { level: tree.maxDepth }) }}</span>
      </div>
      <div class="binary-tree-levels" :aria-label="t('publicTree.allLevels')">
        <button v-for="level in tree.levels" :key="level.depth" :class="{ active: level.depth > branchDepth && level.depth <= branchDepth + tree.visibleDepth }" :aria-label="t('publicTree.levelCount', { level: level.depth, filled: number(level.filled) })" @click="showLevel(level.depth)"><span>{{ t('publicTree.level', { level: level.depth }) }}</span><strong>{{ number(level.filled) }}<small>{{ t('ui.members') }}</small></strong></button>
      </div>
      <div class="binary-tree-toolbar">
        <div class="binary-tree-branch-controls"><button class="button button-outline button-small" :disabled="!branch" @click="branch = ''"><AppIcon name="House" :size="14" />{{ t('publicTree.root') }}</button><button class="button button-outline button-small" :disabled="!branch" @click="branch = treeParentPath(branch)"><AppIcon name="ArrowUp" :size="14" />{{ t('publicTree.up') }}</button><span aria-live="polite">{{ t('publicTree.showing', { from: branchDepth, to: branchDepth + tree.visibleDepth, max: tree.maxDepth }) }}</span></div>
        <div class="binary-tree-options"><AppDropdown v-model="levels" :label="t('publicTree.visibleLevels')" compact :options="(mode === 'matrix' ? [3] : [3, 4, 5, referralTreeDepth]).map(value => ({ value, label: t('publicTree.levelWindow', { levels: value }) }))" /><div class="tree-zoom-controls" role="group" :aria-label="t('ui.tree_zoom')"><button :aria-label="t('ui.zoom_out')" :disabled="zoom <= 50" @click="zoom -= 25">−</button><span>{{ zoom }}%</span><button :aria-label="t('ui.zoom_in')" :disabled="zoom >= 150" @click="zoom += 25">+</button></div></div>
      </div>
      <p v-if="branch" class="binary-tree-path">{{ t('publicTree.branch') }}: {{ treePathSlots(branch).map(slot => t('publicTree.branchNumber', { number: number(Number(slot) + 1) })).join(' › ') }}</p>
      <div ref="viewport" class="binary-tree-viewport" tabindex="0" role="region" :aria-label="t('publicTree.scroll')" @scroll.passive="updateViewport">
        <svg :viewBox="`0 0 ${layout.width} ${layout.height}`" :width="layout.width * zoom / 100" :height="layout.height * zoom / 100" role="group" :aria-label="t('publicTree.treeLabel')">
          <title>{{ t('publicTree.memberTitle', { id: tree.root.id }) }}</title>
          <g v-for="node in layout.nodes.filter(node => node.parent)" :key="`edge-${node.path}`" data-tree-edge="true" :data-parent-path="node.parent!.path" :data-child-path="node.path"><path :d="`M${node.parent!.x},${node.parent!.y + cardHeight} V${node.y - 22} H${node.x} V${node.y}`" fill="none" :stroke="node.member ? 'var(--tree-line)' : 'var(--border)'" :stroke-dasharray="node.member ? undefined : '4 5'" stroke-width="1.5" /></g>
          <g v-for="node in layout.nodes" :key="node.path" :transform="`translate(${node.x - cardWidth / 2},${node.y})`" data-tree-node="true" :data-path="node.path" :data-member-id="node.member?.id" :data-empty="!node.member" :role="node.depth < maxDepth && node.path !== branch ? 'button' : undefined" :tabindex="node.depth < maxDepth && node.path !== branch ? 0 : undefined" :aria-label="t('publicTree.nodeLabel', { level: node.depth, id: node.member?.id || '—' })" :class="{ 'binary-tree-clickable': node.depth < maxDepth && node.path !== branch }" @click="node.depth < maxDepth && explore(node.path)" @keydown.enter.prevent="node.depth < maxDepth && explore(node.path)" @keydown.space.prevent="node.depth < maxDepth && explore(node.path)">
            <title>{{ t('publicTree.nodeLabel', { level: node.depth, id: node.member?.id || '—' }) }}</title>
            <rect :width="cardWidth" :height="cardHeight" rx="10" :fill="node.member ? 'var(--gold-soft)' : 'var(--surface)'" :stroke="node.member ? 'var(--gold-border)' : 'var(--border)'" :stroke-dasharray="node.member ? undefined : '4 4'" />
            <text x="12" y="19" font-size="9" fill="var(--text-secondary)">{{ t('publicTree.level', { level: node.depth }) }}</text>
            <foreignObject x="12" y="27" :width="cardWidth - 24" height="18">
              <div class="binary-tree-node-id" :title="node.member ? t('publicTree.id') + ' ' + node.member.id : undefined">{{ t('publicTree.id') }} {{ node.member?.id || '—' }}</div>
            </foreignObject>
            <text v-if="node.depth < maxDepth && node.path !== branch" x="117" y="20" text-anchor="middle" font-size="13" fill="var(--gold-text)">↓</text>
          </g>
        </svg>
      </div>
      <p class="binary-tree-note"><span class="green-dot"></span>{{ t('publicTree.placementHint') }}<span v-if="status === 'pending'" role="status">{{ t('publicTree.loading') }}</span></p>
    </template>
    <p v-else class="binary-tree-message" role="status">{{ t('publicTree.loading') }}</p>
  </section>
</template>

<style scoped>
.binary-referral-tree { min-width: 0; max-width: 100%; color: var(--text-primary); }
.binary-tree-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.binary-tree-header > div { flex: 1; min-width: 0; }
.binary-tree-header > .outline-pill { flex-shrink: 0; align-self: flex-start; }
.binary-tree-header h2 { margin: 8px 0; font-size: 21px; overflow-wrap: anywhere; }
.binary-tree-header h2 span { display: block; margin-top: 5px; font-size: 14px; font-weight: 400; color: var(--text-secondary); }
.binary-tree-header p, .binary-tree-note, .binary-tree-path { color: var(--text-secondary); font-size: 12px; line-height: 1.8; }
.binary-tree-levels { display: flex; gap: 6px; overflow-x: auto; padding: 3px 3px 12px; }
.binary-tree-levels button { flex: 1 0 74px; min-width: 74px; border: 1px solid var(--border); border-radius: 8px; padding: 9px; background: var(--surface); text-align: left; }
.binary-tree-levels button.active { border-color: var(--gold-border); background: var(--gold-soft); }.binary-tree-levels button > span { display: block; margin-bottom: 4px; font-size: 10px; color: var(--text-secondary); }
.binary-tree-levels strong { font-size: 12px; }.binary-tree-levels small { display: block; font-size: 9px; font-weight: 400; color: var(--text-secondary); }
.binary-tree-toolbar, .binary-tree-branch-controls, .binary-tree-options { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }.binary-tree-toolbar { justify-content: space-between; margin: 10px 0 15px; }.binary-tree-branch-controls > span { color: var(--text-secondary); font-size: 11px; }
.binary-tree-options :deep(.app-dropdown) { min-width: 115px; }.binary-tree-viewport { overflow: auto; max-height: 650px; border: 1px solid var(--border); border-radius: 12px; background: var(--tree-bg); overscroll-behavior: contain; }
.binary-tree-viewport svg { display: block; max-width: none; font-family: inherit; }.binary-tree-clickable { cursor: pointer; }.binary-tree-clickable:hover rect, .binary-tree-clickable:focus rect { stroke: var(--gold); stroke-width: 2; }
.binary-tree-node-id, .binary-tree-node-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 18px; }
.binary-tree-node-id { font-size: 12px; font-weight: 700; color: var(--text-primary); }
.binary-tree-node-name { font-size: 10px; color: var(--text-secondary); }
.binary-tree-path { overflow-wrap: anywhere; margin-bottom: 10px; }.binary-tree-note { display: flex; align-items: center; gap: 8px; margin-top: 13px; flex-wrap: wrap; }.binary-tree-note .green-dot { flex-shrink: 0; }.binary-tree-message { display: grid; justify-items: center; padding: 48px 15px; gap: 14px; text-align: center; color: var(--text-secondary); }
@media (max-width: 600px) { .binary-tree-header { gap: 8px; }.binary-tree-options { width: 100%; justify-content: space-between; }.binary-tree-levels button { flex-basis: 68px; min-width: 68px; }.binary-tree-viewport { max-height: 520px; } }
</style>
