<script setup lang="ts">
const props = defineProps<{ page: number; total: number; pageSize: number }>();
defineEmits<{ change: [page: number] }>();
const { t } = useLoopI18n();
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
</script>
<template><div class="admin-pagination"><span>{{ t('admin.results', { total }) }}</span><div><button class="icon-button" :aria-label="t('admin.previousPage')" :disabled="page <= 1" @click="$emit('change', page - 1)"><AppIcon name="ArrowLeft" :size="17" /></button><span>{{ t('admin.pageOf', { page, pages }) }}</span><button class="icon-button" :aria-label="t('admin.nextPage')" :disabled="page >= pages" @click="$emit('change', page + 1)"><AppIcon name="ArrowRight" :size="17" /></button></div></div></template>
