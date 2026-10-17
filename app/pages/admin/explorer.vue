<script setup lang="ts">
definePageMeta({ layout: "admin", middleware: "admin" });
const { t } = useLoopI18n();
const root = ref<HTMLElement | null>(null);
usePageMotion(root);
useHead({ title: computed(() => `${t('explorer.title')} · UNXO`) });
</script>
<template>
  <main ref="root" class="admin-content"><div class="admin-page-heading"><div><span class="admin-eyebrow">{{ t('explorer.adminEyebrow') }}</span><h1>{{ t('explorer.heading') }}</h1><p>{{ t('explorer.adminSubtitle') }}</p></div><span class="admin-count-badge"><AppIcon name="ShieldCheck" :size="16" />{{ t('admin.liveData') }}</span></div><PlatformExplorer admin /></main>
</template>
