<script setup lang="ts">
const props = defineProps<{ period: string }>();
const selected = ref<number | null>(null);
const values = computed(() =>
  props.period === "7D"
    ? [14, 22, 16, 30, 25, 42, 35]
    : props.period === "90D"
      ? [18, 25, 20, 35, 30, 44, 38, 52, 46, 62, 57, 76, 65, 82]
      : [12, 20, 16, 29, 22, 34, 30, 43, 37, 48, 41, 62, 52, 74],
);
const points = computed(() =>
  values.value
    .map(
      (v, i) =>
        `${50 + i * (650 / (values.value.length - 1))},${190 - v * 1.8}`,
    )
    .join(" "),
);
const labels = computed(() =>
  props.period === "7D"
    ? ["Oct 10", "Oct 11", "Oct 12", "Oct 13", "Oct 14", "Oct 15", "Oct 16"]
    : props.period === "90D"
      ? ["Jul 19", "Aug 2", "Aug 17", "Sep 1", "Sep 16", "Oct 1", "Oct 16"]
      : ["Sep 17", "Sep 22", "Sep 27", "Oct 2", "Oct 7", "Oct 12", "Oct 16"],
);
watch(
  () => props.period,
  () => {
    selected.value = null;
  },
);
</script>
<template>
  <div class="earnings-chart">
    <svg
      viewBox="0 0 740 235"
      role="img"
      :aria-label="`Illustrative earnings over ${period === '7D' ? '7' : period === '90D' ? '90' : '30'} days`"
    >
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ed704b" stop-opacity=".16" />
          <stop offset="100%" stop-color="#ed704b" stop-opacity="0" />
        </linearGradient>
      </defs>
      <g v-for="(label, index) in [100, 75, 50, 25, 0]" :key="label">
        <line
          x1="49"
          x2="713"
          :y1="20 + index * 43"
          :y2="20 + index * 43"
          stroke="#eeedeb"
          stroke-dasharray="4 5"
        />
        <text x="5" :y="24 + index * 43" fill="#92918b" font-size="10">
          {{ label }}
        </text>
      </g>
      <polygon :points="`50,192 ${points} 700,192`" fill="url(#chartFill)" />
      <polyline
        :points="points"
        fill="none"
        stroke="#ed704b"
        stroke-width="2.8"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <g
        v-for="(value, index) in values"
        :key="index"
        class="chart-point"
        @mouseenter="selected = index"
        @mouseleave="selected = null"
      >
        <circle
          :cx="50 + index * (650 / (values.length - 1))"
          :cy="190 - value * 1.8"
          r="13"
          fill="transparent"
        />
        <circle
          v-if="selected === index"
          :cx="50 + index * (650 / (values.length - 1))"
          :cy="190 - value * 1.8"
          r="4"
          fill="#ed704b"
          stroke="white"
          stroke-width="2"
        />
        <text
          v-if="selected === index"
          :x="50 + index * (650 / (values.length - 1))"
          :y="176 - value * 1.8"
          text-anchor="middle"
          fill="#a4442b"
          font-size="11"
          font-weight="600"
        >
          {{ value }} USDC
        </text>
      </g>
      <text
        v-for="(label, index) in labels"
        :key="label"
        :x="50 + index * (650 / 6)"
        y="225"
        text-anchor="middle"
        fill="#92918b"
        font-size="10"
      >
        {{ label }}
      </text>
    </svg>
  </div>
</template>
