<script setup lang="ts">const external = useRuntimeConfig().public.walletMode !== "embedded";</script>
<template><WalletAuthModal v-if="external" /><EmbeddedAuthModal v-else /></template>
