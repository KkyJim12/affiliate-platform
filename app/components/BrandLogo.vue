<script setup lang="ts">
withDefaults(defineProps<{ light?: boolean; symbol?: boolean }>(), { light: false, symbol: false });
</script>
<template>
  <span class="brand-logo" :class="{ 'brand-light': light, 'brand-symbol': symbol }">
    <img src="/unxo-horizontal.webp" alt="UNXO" width="1086" height="362" decoding="async" />
  </span>
</template>

<style scoped>
.brand-logo { display: inline-flex; position: relative; align-items: center; flex-shrink: 0; width: calc(var(--brand-height, 48px) * 3); height: var(--brand-height, 48px); max-width: 100%; gap: 0; overflow: hidden; vertical-align: middle; }
.brand-logo > img { display: block; width: calc(var(--brand-height, 48px) * 3); height: var(--brand-height, 48px); max-width: none; flex-shrink: 0; object-fit: contain; }
.brand-symbol { width: var(--brand-height, 48px); }
</style>
