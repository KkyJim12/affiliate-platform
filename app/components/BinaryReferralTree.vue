<script setup lang="ts">
import { binaryTreeDepth, type BinaryReferralTree } from "#shared/referral-tree";

const props = defineProps<{ memberId: string }>();
const { t, localeTag } = useLoopI18n();
const branch = ref("");
const levels = ref(3);
const zoom = ref(100);
const viewport = ref<HTMLElement | null>(null);
const scrollLeft = ref(0);
const viewportWidth = ref(1000);
let focusedLevel: number | undefined;
const requestKey = useId();
const { data: tree, status, error, refresh } = await useFetch<BinaryReferralTree>("/api/referrals/tree", {
  key: `binary-tree-${requestKey}`,
  query: { id: computed(() => props.memberId), path: branch, levels },
});
watch(() => props.memberId, () => { branch.value = ""; });
const failed = computed(() => error.value?.statusCode === 404 ? t('publicTree.notFound') : t('publicTree.loadError'));
const byPath = computed(() => new Map((tree.value?.members ?? []).map(member => [member.path, member])));
const cardWidth = 132;
const cardHeight = 78;
const rowHeight = 120;
const layout = computed(() => {
  if (!tree.value) return { nodes: [], width: 800, height: 440 };
  const depth = tree.value.visibleDepth;
  const width = Math.max(800, 2 ** depth * 152 + 40);
  const left = scrollLeft.value * 100 / zoom.value;
  const right = (scrollLeft.value + viewportWidth.value) * 100 / zoom.value;
  // Deep trees have up to 65,535 positions. Keep adjacent positions for
  // connecting lines, and create only the columns near the viewport.
  const nodes = Array.from({ length: depth + 1 }, (_, relativeDepth) => {
    const count = 2 ** relativeDepth;
    const spacing = width / count;
    const first = depth <= 5 ? 0 : Math.max(0, Math.floor((left - cardWidth) / spacing - 1));
    const last = depth <= 5 ? count - 1 : Math.min(count - 1, Math.ceil((right + cardWidth) / spacing));
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => {
      const offset = first + index;
      const suffix = relativeDepth ? offset.toString(2).padStart(relativeDepth, '0') : '';
      const path = tree.value!.path + suffix;
      return { path, depth: path.length, member: byPath.value.get(path),
        x: (offset + 0.5) * spacing, y: 22 + relativeDepth * rowHeight,
        parent: relativeDepth ? { x: (Math.floor(offset / 2) + 0.5) * spacing * 2, y: 22 + (relativeDepth - 1) * rowHeight } : null };
    });
  }).flat();
  return { nodes, width, height: 44 + depth * rowHeight + cardHeight };
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
    viewport.value.scrollTop = focusedLevel === undefined ? 0 : Math.max(0, focusedLevel - (tree.value?.path.length ?? 0)) * rowHeight * zoom.value / 100;
    focusedLevel = undefined;
    updateViewport();
  });
}
watch([tree, zoom], centerTree);
onMounted(centerTree);
function explore(path: string) {
  if (path.length <= binaryTreeDepth && path !== branch.value) branch.value = path;
}
function showLevel(depth: number) {
  const start = Math.max(0, depth - levels.value);
  const path = branch.value.slice(0, start).padEnd(start, '0');
  focusedLevel = depth;
  if (path === branch.value) centerTree();
  else explore(path);
}
const number = (value: number) => value.toLocaleString(localeTag.value);
</script>

<template>
  <section class="binary-referral-tree" :aria-label="t('publicTree.treeLabel')" :aria-busy="status === 'pending'" data-testid="binary-referral-tree">
    <div v-if="error" class="binary-tree-message" role="alert"><AppIcon name="Search" :size="28" /><p>{{ failed }}</p><button class="button button-outline button-small" @click="refresh()">{{ t('publicTree.retry') }}</button></div>
    <template v-else-if="tree">
      <div class="binary-tree-header"><div><span class="eyebrow">{{ t('publicTree.structure') }}</span><h2>{{ t('publicTree.memberTitle', { id: tree.root.id }) }} <span>@{{ tree.root.username }}</span></h2><p>{{ t('publicTree.exploreHint') }}</p></div><span class="outline-pill">2 × 15</span></div>
      <div class="binary-tree-levels" :aria-label="t('publicTree.allLevels')">
        <button v-for="level in tree.levels" :key="level.depth" :class="{ active: level.depth > tree.path.length && level.depth <= tree.path.length + tree.visibleDepth }" :aria-label="t('publicTree.levelCount', { level: level.depth, filled: number(level.filled), total: number(level.capacity) })" @click="showLevel(level.depth)"><span>{{ t('publicTree.level', { level: level.depth }) }}</span><strong>{{ number(level.filled) }}<small>/ {{ number(level.capacity) }}</small></strong></button>
      </div>
      <div class="binary-tree-toolbar">
        <div class="binary-tree-branch-controls"><button class="button button-outline button-small" :disabled="!branch" @click="branch = ''"><AppIcon name="House" :size="14" />{{ t('publicTree.root') }}</button><button class="button button-outline button-small" :disabled="!branch" @click="branch = branch.slice(0, -1)"><AppIcon name="ArrowUp" :size="14" />{{ t('publicTree.up') }}</button><span aria-live="polite">{{ t('publicTree.showing', { from: tree.path.length, to: tree.path.length + tree.visibleDepth, max: tree.maxDepth }) }}</span></div>
        <div class="binary-tree-options"><AppDropdown v-model="levels" :label="t('publicTree.visibleLevels')" compact :options="[3, 4, 5, binaryTreeDepth].map(value => ({ value, label: t('publicTree.levelWindow', { levels: value }) }))" /><div class="tree-zoom-controls" role="group" :aria-label="t('ui.tree_zoom')"><button :aria-label="t('ui.zoom_out')" :disabled="zoom <= 50" @click="zoom -= 25">−</button><span>{{ zoom }}%</span><button :aria-label="t('ui.zoom_in')" :disabled="zoom >= 150" @click="zoom += 25">+</button></div></div>
      </div>
      <p v-if="branch" class="binary-tree-path">{{ t('publicTree.branch') }}: {{ branch.split('').map(slot => t(slot === '0' ? 'publicTree.left' : 'publicTree.right')).join(' › ') }}</p>
      <div ref="viewport" class="binary-tree-viewport" tabindex="0" role="region" :aria-label="t('publicTree.scroll')" @scroll.passive="updateViewport">
        <svg :viewBox="`0 0 ${layout.width} ${layout.height}`" :width="layout.width * zoom / 100" :height="layout.height * zoom / 100" role="group" :aria-label="t('publicTree.treeLabel')">
          <title>{{ t('publicTree.memberTitle', { id: tree.root.id }) }} · @{{ tree.root.username }}</title>
          <g v-for="node in layout.nodes.filter(node => node.parent)" :key="`edge-${node.path}`" data-tree-edge="true"><path :d="`M${node.parent!.x},${node.parent!.y + cardHeight} V${node.y - 22} H${node.x} V${node.y}`" fill="none" :stroke="node.member ? 'var(--tree-line)' : 'var(--border)'" :stroke-dasharray="node.member ? undefined : '4 5'" stroke-width="1.5" /></g>
          <g v-for="node in layout.nodes" :key="node.path" :transform="`translate(${node.x - cardWidth / 2},${node.y})`" data-tree-node="true" :data-path="node.path" :data-member-id="node.member?.id" :data-empty="!node.member" :role="node.depth < 15 && node.path !== branch ? 'button' : undefined" :tabindex="node.depth < 15 && node.path !== branch ? 0 : undefined" :aria-label="t('publicTree.nodeLabel', { level: node.depth, id: node.member?.id || '—', username: node.member?.username || t('publicTree.empty') })" :class="{ 'binary-tree-clickable': node.depth < 15 && node.path !== branch }" @click="node.depth < 15 && explore(node.path)" @keydown.enter.prevent="node.depth < 15 && explore(node.path)" @keydown.space.prevent="node.depth < 15 && explore(node.path)">
            <title>{{ t('publicTree.nodeLabel', { level: node.depth, id: node.member?.id || '—', username: node.member?.username || t('publicTree.empty') }) }}</title>
            <rect :width="cardWidth" :height="cardHeight" rx="10" :fill="node.member ? 'var(--gold-soft)' : 'var(--surface)'" :stroke="node.member ? 'var(--gold-border)' : 'var(--border)'" :stroke-dasharray="node.member ? undefined : '4 4'" />
            <text x="12" y="19" font-size="9" fill="var(--text-secondary)">{{ t('publicTree.level', { level: node.depth }) }}</text><text x="12" y="39" font-size="12" font-weight="700" fill="var(--text-primary)">{{ t('publicTree.id') }} {{ node.member?.id || '—' }}</text>
            <text x="12" y="60" font-size="10" fill="var(--text-secondary)">{{ node.member ? '@' + (node.member.username.length > 17 ? node.member.username.slice(0, 16) + '…' : node.member.username) : t('publicTree.empty') }}</text>
            <text v-if="node.depth < 15 && node.path !== branch" x="117" y="20" text-anchor="middle" font-size="13" fill="var(--gold-text)">↓</text>
          </g>
        </svg>
      </div>
      <p class="binary-tree-note"><span class="green-dot"></span>{{ t('publicTree.placementHint') }}<span v-if="status === 'pending'" role="status">{{ t('publicTree.loading') }}</span></p>
    </template>
    <p v-else class="binary-tree-message" role="status">{{ t('publicTree.loading') }}</p>
  </section>
</template>

<style scoped>
.binary-referral-tree { min-width: 0; color: var(--text-primary); }
.binary-tree-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.binary-tree-header h2 { margin: 8px 0; font-size: 21px; }.binary-tree-header h2 span { font-size: 14px; font-weight: 400; color: var(--text-secondary); }
.binary-tree-header p, .binary-tree-note, .binary-tree-path { color: var(--text-secondary); font-size: 12px; line-height: 1.8; }
.binary-tree-levels { display: flex; gap: 6px; overflow-x: auto; padding: 3px 3px 12px; }
.binary-tree-levels button { flex: 1 0 74px; min-width: 74px; border: 1px solid var(--border); border-radius: 8px; padding: 9px; background: var(--surface); text-align: left; }
.binary-tree-levels button.active { border-color: var(--gold-border); background: var(--gold-soft); }.binary-tree-levels button > span { display: block; margin-bottom: 4px; font-size: 10px; color: var(--text-secondary); }
.binary-tree-levels strong { font-size: 12px; }.binary-tree-levels small { display: block; font-size: 9px; font-weight: 400; color: var(--text-secondary); }
.binary-tree-toolbar, .binary-tree-branch-controls, .binary-tree-options { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }.binary-tree-toolbar { justify-content: space-between; margin: 10px 0 15px; }.binary-tree-branch-controls > span { color: var(--text-secondary); font-size: 11px; }
.binary-tree-options :deep(.app-dropdown) { min-width: 115px; }.binary-tree-viewport { overflow: auto; max-height: 650px; border: 1px solid var(--border); border-radius: 12px; background: var(--tree-bg); overscroll-behavior: contain; }
.binary-tree-viewport svg { display: block; max-width: none; font-family: inherit; }.binary-tree-clickable { cursor: pointer; }.binary-tree-clickable:hover rect, .binary-tree-clickable:focus rect { stroke: var(--gold); stroke-width: 2; }
.binary-tree-path { overflow-wrap: anywhere; margin-bottom: 10px; }.binary-tree-note { display: flex; align-items: center; gap: 8px; margin-top: 13px; flex-wrap: wrap; }.binary-tree-note .green-dot { flex-shrink: 0; }.binary-tree-message { display: grid; justify-items: center; padding: 48px 15px; gap: 14px; text-align: center; color: var(--text-secondary); }
@media (max-width: 600px) { .binary-tree-header h2 span { display: block; margin-top: 5px; }.binary-tree-header { gap: 8px; }.binary-tree-options { width: 100%; justify-content: space-between; }.binary-tree-levels button { flex-basis: 68px; min-width: 68px; }.binary-tree-viewport { max-height: 520px; } }
</style>
