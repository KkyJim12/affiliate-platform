<script setup lang="ts">
withDefaults(defineProps<{ preview?: boolean; compact?: boolean }>(), { preview: false, compact: false });
const external = useRuntimeConfig().public.walletMode !== "embedded";
</script>
<template><ConnectedWalletPanel v-if="external" :preview="preview" :compact="compact" /><EmbeddedWalletPanel v-else :preview="preview" :compact="compact" /></template>
