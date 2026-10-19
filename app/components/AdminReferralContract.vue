<script setup lang="ts">
const emit = defineEmits<{ updated: [] }>();
const external = useRuntimeConfig().public.walletMode !== "embedded";
</script>
<template><ConnectedAdminReferralContract v-if="external" @updated="emit('updated')" /><EmbeddedAdminReferralContract v-else @updated="emit('updated')" /></template>
