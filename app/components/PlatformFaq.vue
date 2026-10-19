<script setup lang="ts">
const { faqs } = usePlatformFaq();
const { t } = useLoopI18n();
const open = ref<number | null>(0);
const uid = useId();
</script>
<template>
  <div class="workspace-faq" data-testid="platform-faq">
    <section class="panel workspace-faq-list"><article v-for="(faq, index) in faqs" :key="index"><h2><button :aria-expanded="open === index" :aria-controls="`answer-${uid}-${index}`" @click="open = open === index ? null : index">{{ faq.q }}<AppIcon :name="open === index ? 'X' : 'Plus'" :size="18" /></button></h2><p v-if="open === index" :id="`answer-${uid}-${index}`">{{ faq.a }}</p></article></section>
    <div class="workspace-faq-links"><NuxtLink to="/faq/ranks" class="panel"><AppIcon name="Layers" :size="24" /><strong>{{ t('ui.ranks_commissions') }}</strong><span>{{ t('workspace.ranksHint') }}</span><AppIcon name="ArrowUpRight" :size="17" /></NuxtLink><NuxtLink to="/faq/analytics" class="panel"><AppIcon name="TrendingUp" :size="24" /><strong>{{ t('workspace.analytics') }}</strong><span>{{ t('workspace.analyticsHint') }}</span><AppIcon name="ArrowUpRight" :size="17" /></NuxtLink></div>
  </div>
</template>
<style scoped>
.workspace-faq { display: grid; gap: 22px; }
.workspace-faq-list article + article { border-top: 1px solid var(--border); }
.workspace-faq-list button { display: flex; justify-content: space-between; align-items: center; gap: 20px; width: 100%; text-align: left; padding: 24px; font-size: 15px; font-weight: 600; color: var(--text-primary); }
.workspace-faq-list button svg { flex-shrink: 0; color: var(--gold-text); }
.workspace-faq-list p { padding: 0 24px 24px; color: var(--text-secondary); font-size: 13px; line-height: 1.9; }
.workspace-faq-links { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 22px; }
.workspace-faq-links a { display: grid; gap: 14px; padding: 24px; }
.workspace-faq-links svg { color: var(--gold-text); }
.workspace-faq-links span { color: var(--text-secondary); font-size: 12px; line-height: 1.8; }
@media(max-width:650px) { .workspace-faq-links { grid-template-columns: 1fr; } }
</style>
