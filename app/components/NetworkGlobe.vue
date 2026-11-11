<script setup lang="ts">
// Deterministic points keep server and client markup identical.
const points = Array.from({ length: 440 }, (_, index) => {
  const latitude = Math.acos(1 - 2 * (index + .5) / 440);
  const longitude = index * 2.399963;
  const x = Math.sin(latitude) * Math.cos(longitude);
  const y = Math.cos(latitude);
  const z = Math.sin(latitude) * Math.sin(longitude);
  return { x: 500 + x * 438, y: 420 + y * 340, radius: z > 0 ? 1.8 : 1, opacity: z > 0 ? .8 : .22 };
});
const nodes = [
  { x: 160, y: 276 }, { x: 317, y: 155 }, { x: 487, y: 99 },
  { x: 685, y: 163 }, { x: 831, y: 278 }, { x: 388, y: 355 },
  { x: 633, y: 393 }, { x: 206, y: 481 }, { x: 783, y: 503 },
];
</script>

<template>
  <svg class="network-globe" viewBox="0 0 1000 810" fill="none" aria-hidden="true">
    <defs>
      <radialGradient id="globe-fill" cx=".5" cy=".2" r=".8">
        <stop stop-color="#0878c9" stop-opacity=".38" />
        <stop offset=".6" stop-color="#03265f" stop-opacity=".4" />
        <stop offset="1" stop-color="#010a20" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="globe-edge" x1="180" y1="90" x2="770" y2="750" gradientUnits="userSpaceOnUse">
        <stop stop-color="#acffff" /><stop offset=".4" stop-color="#00c8ff" /><stop offset="1" stop-color="#1557d7" stop-opacity=".1" />
      </linearGradient>
      <filter id="globe-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" />
      </filter>
      <clipPath id="globe-clip"><ellipse cx="500" cy="420" rx="440" ry="342" /></clipPath>
    </defs>
    <ellipse cx="500" cy="420" rx="440" ry="342" fill="url(#globe-fill)" />
    <g clip-path="url(#globe-clip)" stroke="#15a8ed" stroke-opacity=".26">
      <ellipse v-for="width in [95, 220, 350, 430]" :key="width" cx="500" cy="420" :rx="width" ry="342" />
      <ellipse v-for="height in [75, 170, 270]" :key="height" cx="500" cy="420" rx="440" :ry="height" />
      <path d="M60 420H940M500 78V762M160 276L317 155L487 99L685 163L831 278L633 393L388 355L206 481L783 503L685 163M317 155L388 355L487 99L633 393L831 278M160 276L388 355L783 503" />
    </g>
    <g fill="#4cddff"><circle v-for="(point, index) in points" :key="index" :cx="point.x" :cy="point.y" :r="point.radius" :opacity="point.opacity" /></g>
    <ellipse cx="500" cy="420" rx="440" ry="342" stroke="url(#globe-edge)" stroke-width="9" filter="url(#globe-glow)" />
    <ellipse cx="500" cy="420" rx="440" ry="342" stroke="url(#globe-edge)" stroke-width="2" />
    <g v-for="(node, index) in nodes" :key="index">
      <circle :cx="node.x" :cy="node.y" r="10" fill="#00d5ff" filter="url(#globe-glow)" />
      <circle :cx="node.x" :cy="node.y" r="3" fill="#e5ffff" />
      <path :d="`M${node.x - 9} ${node.y}h18M${node.x} ${node.y - 9}v18`" stroke="#b1f7ff" stroke-width="1" />
    </g>
  </svg>
</template>
