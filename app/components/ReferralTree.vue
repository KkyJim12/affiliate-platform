<script setup lang="ts">
const { t, tr, localeTag, formatDate } = useLoopI18n();

import type { ReferralNode } from "../../shared/types";

const props = defineProps<{
  members: ReferralNode[];
  rootId: string;
  memberId: string;
  matchingIds: string[];
  filtered: boolean;
  interactive?: boolean;
  selectedId?: string;
  rootLabel?: string;
}>();
const emit = defineEmits<{ select: [id: string] }>();
const { notify } = useAppUI();
const viewport = ref<HTMLElement | null>(null);
const diagram = ref<SVGSVGElement | null>(null);
const zoom = ref(100);
const maxDepth = ref(3);
const cardWidth = 168;
const cardHeight = 78;
const rowHeight = 142;
interface PositionedNode {
  id: string; parentId: string | null; memberId: string; status: string;
  depth: number; x: number; y: number; context: boolean; deeper: number;
}
const included = computed(() => {
  if (!props.filtered) return new Set(props.members.map((member) => member.id));
  const result = new Set(props.matchingIds);
  const byId = new Map(props.members.map((member) => [member.id, member]));
  for (const id of props.matchingIds) {
    let parentId = byId.get(id)?.parentId;
    while (parentId && parentId !== props.rootId && !result.has(parentId)) {
      result.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
  }
  return result;
});
const matching = computed(() => new Set(props.matchingIds));
const effectiveDepth = computed(() => props.filtered
  ? Math.max(maxDepth.value, ...props.members.filter((member) => matching.value.has(member.id)).map((member) => member.depth))
  : maxDepth.value);
const layout = computed(() => {
  const members = props.members.filter((member) => included.value.has(member.id) && member.depth <= effectiveDepth.value);
  const children = new Map<string, ReferralNode[]>();
  for (const member of members) children.set(member.parentId, [...(children.get(member.parentId) || []), member]);
  const nodes: PositionedNode[] = [];
  let cursor = 36;
  function place(member: { id: string; parentId: string | null; memberId: string; status: string; depth: number }): PositionedNode {
    const descendants = (children.get(member.id) || []).map(place);
    const x = descendants.length ? (descendants[0]!.x + descendants[descendants.length - 1]!.x) / 2 : cursor + cardWidth / 2;
    if (!descendants.length) cursor += cardWidth + 30;
    const node = { ...member, x, y: 42 + member.depth * rowHeight, context: props.filtered && member.depth > 0 && !matching.value.has(member.id), deeper: props.members.filter((item) => included.value.has(item.id) && item.parentId === member.id && item.depth > effectiveDepth.value).length };
    nodes.push(node);
    return node;
  }
  const root = place({ id: props.rootId, parentId: null, memberId: props.memberId, status: props.rootLabel || "Your account", depth: 0 });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    nodes, root,
    edges: nodes.filter((node) => node.parentId && byId.has(node.parentId)).map((node) => ({ id: node.id, from: byId.get(node.parentId!)!, to: node })),
    width: Math.max(cursor + 6, 240),
    height: Math.max(...nodes.map((node) => node.y)) + cardHeight + 72,
    depth: Math.max(...nodes.map((node) => node.depth)),
  };
});
const noMatches = computed(() => props.filtered && !props.matchingIds.length);
const hiddenCount = computed(() => props.members.filter((member) => included.value.has(member.id) && member.depth > effectiveDepth.value).length);
const clipName = (name: string) => name.length > 19 ? `${name.slice(0, 18)}…` : name;
function centerTree() {
  nextTick(() => {
    if (!viewport.value) return;
    viewport.value.scrollLeft = layout.value.root.x * zoom.value / 100 - viewport.value.clientWidth / 2;
    viewport.value.scrollTop = 0;
  });
}
function resetView() { zoom.value = 100; centerTree(); }
watch([layout, zoom], centerTree);
onMounted(centerTree);
function downloadImage() {
  if (!diagram.value) return;
  const source = diagram.value.cloneNode(true) as SVGSVGElement;
  source.setAttribute("role", "img");
  for (const node of source.querySelectorAll('[role="button"]')) {
    for (const attribute of ["role", "tabindex", "aria-pressed"]) node.removeAttribute(attribute);
  }
  source.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  source.setAttribute("width", String(layout.value.width));
  source.setAttribute("height", String(layout.value.height));
  // Resolve theme tokens so downloaded SVGs need no external stylesheet.
  const palette = getComputedStyle(diagram.value);
  for (const element of [source, ...source.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      if (!attribute.value.includes("var(")) continue;
      element.setAttribute(attribute.name, attribute.value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => palette.getPropertyValue(name).trim()));
    }
  }
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(source)], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "loop-referral-tree.svg"; link.click(); URL.revokeObjectURL(url);
  notify("Your referral tree image has been downloaded.");
}
</script>

<template>
  <div class="referral-tree-view">
    <div class="referral-tree-toolbar">
      <div class="tree-depth-control"><label for="referral-tree-depth">{{ t('ui.show_levels') }}</label><AppDropdown id="referral-tree-depth" v-model="maxDepth" :label="t('ui.show_levels')" compact :options="[{ value: 3, label: t('ui.3_levels') }, { value: 5, label: t('ui.5_levels') }, { value: 15, label: t('ui.15_levels') }]" /></div>
      <div class="tree-zoom-controls" role="group" :aria-label="t('ui.tree_zoom')"><button :aria-label="t('ui.zoom_out')" :disabled="zoom <= 50" @click="zoom -= 25">−</button><span aria-live="polite">{{ zoom }}%</span><button :aria-label="t('ui.zoom_in')" :disabled="zoom >= 150" @click="zoom += 25">+</button><button class="tree-reset-button" :aria-label="t('ui.reset_tree_view')" @click="resetView"><AppIcon name="RefreshCw" :size="14" /></button></div>
      <button class="button button-outline button-small tree-download" :disabled="noMatches" @click="downloadImage"><AppIcon name="Download" :size="15" />{{ t('ui.download_image') }}</button>
    </div>
    <div v-if="noMatches" class="referral-tree-empty"><AppIcon name="Search" :size="27" /><h3>{{ t('ui.no_matching_referrals') }}</h3><p>{{ t('ui.try_another_username_or_status') }}</p></div>
    <div v-else ref="viewport" class="referral-tree-viewport" tabindex="0" role="region" :aria-label="t('ui.scrollable_referral_tree')">
      <svg ref="diagram" :viewBox="`0 0 ${layout.width} ${layout.height}`" :width="layout.width * zoom / 100" :height="layout.height * zoom / 100" class="referral-network-image" :role="interactive ? 'group' : 'img'" :aria-label="t('ui.referral_network_tree_p0_members_across_p1_levels', { p0: layout.nodes.length - 1, p1: layout.depth })" style="font-family: 'Noto Sans Thai Variable', Tahoma, Arial, sans-serif; display: block; max-width: none;">
        <title>{{ t('ui.username_s_referral_network', { memberId: memberId === 'You' ? tr('You') : memberId }) }}</title>
        <desc>{{ t('ui.each_connecting_line_shows_who_invited_the_member_below_muted_ancestors_keep_the_matc') }}</desc>
        <rect width="100%" height="100%" fill="var(--tree-bg)" />
        <g v-for="edge in layout.edges" :key="edge.id" data-tree-edge="true" :data-parent-member="edge.from.memberId" :data-child-member="edge.to.memberId"><path :d="`M${edge.from.x},${edge.from.y + cardHeight} V${edge.to.y - 30} H${edge.to.x} V${edge.to.y}`" fill="none" :stroke="edge.to.context ? 'var(--border)' : 'var(--tree-line)'" stroke-width="1.7" /><circle :cx="edge.to.x" :cy="edge.to.y - 5" r="3" fill="var(--tree-line)" /></g>
        <g v-for="node in layout.nodes" :key="node.id" :transform="`translate(${node.x - cardWidth / 2},${node.y})`" :opacity="node.context ? 0.5 : 1" :data-member="node.memberId" data-tree-node="true" :style="{ '--node-depth': Math.min(node.depth, 4) }" :role="interactive ? 'button' : undefined" :tabindex="interactive ? 0 : undefined" :aria-label="interactive ? t('explorer.inspectMember', { memberId: node.memberId }) : undefined" :aria-pressed="interactive ? selectedId === node.id : undefined" :class="{ 'explorer-tree-node': interactive, 'explorer-tree-selected': interactive && selectedId === node.id }" @click="interactive && emit('select', node.id)" @keydown.enter.prevent="interactive && emit('select', node.id)" @keydown.space.prevent="interactive && emit('select', node.id)">
          <title>{{ node.depth === 0 ? (rootLabel || t('ui.your_account')) : t('ui.level_p0', { p0: node.depth }) }} · ID {{ node.memberId }} · {{ tr(node.status) }}</title>
          <rect :width="cardWidth" :height="cardHeight" rx="12" :fill="node.depth === 0 ? 'var(--gold-soft)' : 'var(--surface)'" :stroke="node.depth === 0 ? 'var(--gold-border)' : 'var(--border)'" stroke-width="1.3" />
          <circle cx="28" cy="28" r="15" :fill="node.depth === 0 ? 'var(--gold)' : node.status === 'Qualified' ? 'var(--success-soft)' : 'var(--gold-soft)'" />
          <text x="28" y="32" text-anchor="middle" font-size="10" font-weight="600" :fill="node.depth === 0 ? 'var(--button-ink)' : 'var(--text-secondary)'">{{ node.memberId.slice(0, 2).toUpperCase() }}</text>
          <text x="51" y="24" font-size="10" font-weight="600" fill="var(--text-primary)">{{ node.depth === 0 ? (rootLabel || t('ui.your_account')) : t('ui.level_p0', { p0: node.depth }) }}</text>
          <text x="51" y="39" font-size="9" fill="var(--text-secondary)">{{ node.depth === 1 ? t('ui.direct_referral') : node.depth > 1 ? t('ui.indirect_referral') : t('ui.network_root') }}</text>
          <text x="14" y="62" font-size="10" font-weight="500" fill="var(--text-primary)">{{ node.depth === 0 && memberId === 'You' ? t('ui.you') : 'ID ' + clipName(node.memberId) }}</text>
          <circle v-if="node.depth > 0" cx="151" cy="59" r="3" :fill="node.status === 'Qualified' ? 'var(--success)' : 'var(--gold)'" />
          <text v-if="node.deeper" :x="cardWidth / 2" :y="cardHeight + 19" text-anchor="middle" font-size="9" fill="var(--text-secondary)">+ {{ node.deeper }} {{ node.deeper === 1 ? tr('connection') : tr('connections') }} {{ t('ui.below') }}</text>
        </g>
        <text v-if="!members.length" :x="layout.root.x" :y="layout.root.y + 139" text-anchor="middle" font-size="11" fill="var(--text-secondary)">{{ t('ui.your_next_connection_starts_this_tree') }}</text>
      </svg>
    </div>
    <div class="referral-tree-caption"><div class="referral-tree-legend"><span><i class="tree-root-dot"></i>{{ rootLabel || t('ui.you') }}</span><span><i class="tree-qualified-dot"></i>{{ t('ui.qualified') }}</span><span><i class="tree-registered-dot"></i>{{ t('ui.registered') }}</span></div><p>{{ noMatches ? t('ui.no_matching_members') : hiddenCount ? t('ui.p0_more_members_below_increase_the_level_limit_to_see_them', { p0: hiddenCount }) : t('ui.scroll_to_explore_use_and_to_zoom') }}</p></div>
    <p class="referral-tree-note">{{ filtered && matchingIds.length ? t('ui.matching_branches_include_their_ancestors_for_context') + " " : '' }}{{ t('workspace.referralTreeNote') }}</p>
  </div>
</template>
