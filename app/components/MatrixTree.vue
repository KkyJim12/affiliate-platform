<script setup lang="ts">
const { t, tr, localeTag, formatDate } = useLoopI18n();

const props = withDefaults(defineProps<{ preview?: boolean; username?: string }>(), { preview: false, username: "You" });
const sampleNames = ["AM", "JC", "TK", "SW", "JL", "RP", "CB", "DM", "KL", "AJ", "MT"];
const nodes = computed(() => Array.from({ length: 15 }, (_, index) => {
  const depth = Math.floor(Math.log2(index + 1));
  const offset = index - (2 ** depth - 1);
  return { index, depth, x: (offset + 0.5) / 2 ** depth * 800, y: 30 + depth * 76, filled: index === 0 || (props.preview && index <= 11), name: index === 0 ? props.username.slice(0, 2).toUpperCase() : sampleNames[index - 1] };
}));
</script>

<template>
  <div class="matrix-tree" role="img" :aria-label="preview ? t('ui.example_binary_matrix_11_of_14_positions_filled_across_three_layers') : t('ui.your_binary_matrix_14_open_positions_across_three_layers')">
    <svg viewBox="0 0 800 290" preserveAspectRatio="none" aria-hidden="true">
      <path v-for="node in nodes.slice(1)" :key="node.index" :pathLength="node.filled ? 100 : undefined" :d="`M${nodes[Math.floor((node.index - 1) / 2)]!.x},${nodes[Math.floor((node.index - 1) / 2)]!.y + 20} V${node.y - 35} H${node.x} V${node.y - 20}`" :class="{ filled: node.filled }" />
    </svg>
    <div v-for="node in nodes" :key="node.index" class="matrix-node" :class="{ filled: node.filled, root: node.index === 0, open: !node.filled }" :style="{ left: `${node.x / 8}%`, top: `${node.y}px`, '--node-depth': node.depth }">
      <span v-if="node.filled">{{ node.name }}</span><AppIcon v-else name="Plus" :size="15" />
      <small v-if="node.index === 0">{{ username }}</small>
    </div>
  </div>
</template>
