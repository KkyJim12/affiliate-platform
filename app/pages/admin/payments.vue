<script setup lang="ts">
definePageMeta({ middleware: "admin", alias: ["/admin/payment"] });
await navigateTo("/admin/dashboard", { replace: true });
</script>
<template><span></span></template>
