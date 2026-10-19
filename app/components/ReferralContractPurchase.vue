<script setup lang="ts">
import type { ReferralProgram } from "#shared/referral";
import type { ReferralChainStatus } from "#shared/referral-contract";
defineProps<{ program: ReferralProgram | null; chain: ReferralChainStatus | null }>();
const emit = defineEmits<{ updated: []; refreshed: [status: ReferralChainStatus] }>();
const external = useRuntimeConfig().public.walletMode !== "embedded";
</script>
<template><ConnectedReferralPurchase v-if="external" :program="program" :chain="chain" @updated="emit('updated')" @refreshed="emit('refreshed', $event)" /><EmbeddedReferralContractPurchase v-else :program="program" :chain="chain" @updated="emit('updated')" @refreshed="emit('refreshed', $event)" /></template>
