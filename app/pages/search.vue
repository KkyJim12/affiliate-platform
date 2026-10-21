<script setup lang="ts">
import { isMemberId } from "#shared/referral-code";
definePageMeta({ alias: ['/tree'] });
const { t } = useLoopI18n();
const route = useRoute();
const { user } = useAccount();
const input = ref(typeof route.query.id === 'string' ? route.query.id : '');
const submitted = computed(() => typeof route.query.id === 'string' ? route.query.id.trim() : '');
const invalid = ref(false);
watch(() => route.query.id, () => { input.value = submitted.value; invalid.value = !!submitted.value && !isMemberId(submitted.value); }, { immediate: true });
useHead({ title: computed(() => `${t('publicTree.title')} - UNXO`) });
async function search() {
  const id = input.value.trim();
  invalid.value = !isMemberId(id);
  if (!invalid.value) await navigateTo({ path: '/search', query: { id } });
}
</script>

<template>
  <div class="public-tree-page">
    <header class="public-tree-nav page-width"><NuxtLink to="/" :aria-label="t('ui.loop_home')"><BrandLogo /></NuxtLink><div><NuxtLink to="/dashboard" class="text-link">{{ t('workspace.launchApp') }}<AppIcon name="ArrowUpRight" :size="16" /></NuxtLink><LocaleSwitcher /><ThemeToggle /><ProfileMenu v-if="user" /></div></header>
    <main class="page-width public-tree-main">
      <div class="public-tree-intro"><span class="eyebrow"><AppIcon name="GitFork" :size="16" />{{ t('publicTree.public') }}</span><h1>{{ t('publicTree.title') }}</h1><p>{{ t('publicTree.subtitle') }}</p></div>
      <form class="public-tree-search panel" @submit.prevent="search"><div><label for="public-member-id">{{ t('publicTree.memberId') }}</label><div class="public-tree-input"><AppIcon name="Search" :size="19" /><input id="public-member-id" v-model="input" inputmode="numeric" maxlength="16" autocomplete="off" :placeholder="t('publicTree.placeholder')" :aria-invalid="invalid" :aria-describedby="invalid ? 'member-id-error' : undefined" /></div></div><button class="button button-orange" type="submit">{{ t('publicTree.search') }}<AppIcon name="ArrowRight" :size="17" /></button><NuxtLink v-if="user?.memberId" :to="{ path: '/search', query: { id: user.memberId } }" class="text-link">{{ t('publicTree.myTree', { id: user.memberId }) }}</NuxtLink><p v-if="invalid" id="member-id-error" class="auth-error" role="alert">{{ t('publicTree.invalidId') }}</p></form>
      <div v-if="submitted && !invalid" class="panel public-tree-result"><BinaryReferralTree :key="submitted" :member-id="submitted" /></div>
      <div v-else class="public-tree-welcome panel"><span class="public-tree-symbol"><AppIcon name="GitFork" :size="36" /></span><h2>{{ t('publicTree.welcomeTitle') }}</h2><p>{{ t('publicTree.welcomeHint') }}</p><div><span>2 <small>{{ t('publicTree.branches') }}</small></span><span>15 <small>{{ t('publicTree.steps') }}</small></span><span>65,534 <small>{{ t('publicTree.positions') }}</small></span></div></div>
    </main>
  </div>
</template>

<style scoped>
.public-tree-page .panel { background: var(--surface); border-color: var(--border); }
.public-tree-page { min-height: 100vh; background: var(--canvas); }.public-tree-nav { display: flex; justify-content: space-between; align-items: center; gap: 16px; min-height: 92px; border-bottom: 1px solid var(--border); }.public-tree-nav > div { display: flex; align-items: center; gap: 15px; }.public-tree-nav :deep(.brand-logo) { --brand-height: 38px; }
.public-tree-main { padding-top: 48px; padding-bottom: 60px; }.public-tree-intro { margin-bottom: 28px; }.public-tree-intro .eyebrow { display: flex; align-items: center; gap: 8px; }.public-tree-intro h1 { font-size: clamp(27px, 4vw, 40px); font-weight: 750; margin: 12px 0; letter-spacing: -1px; }.public-tree-intro p { color: var(--text-secondary); max-width: 680px; line-height: 1.8; font-size: 14px; }
.public-tree-search { display: flex; align-items: end; gap: 14px; flex-wrap: wrap; padding: 24px; margin-bottom: 24px; }.public-tree-search > div { flex: 1; min-width: 180px; max-width: 420px; }.public-tree-search label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 9px; }.public-tree-input { display: flex; align-items: center; gap: 10px; border: 1px solid var(--border); background: var(--canvas); border-radius: 9px; padding: 0 13px; color: var(--text-secondary); }.public-tree-input input { min-width: 0; width: 100%; padding: 13px 0; background: transparent; color: var(--text-primary); border: 0; }.public-tree-search > .text-link { padding: 12px 0; font-size: 12px; }.public-tree-search > .auth-error { width: 100%; }
.public-tree-result { padding: 26px; }.public-tree-welcome { padding: 52px 24px; text-align: center; }.public-tree-symbol { display: inline-flex; padding: 18px; background: var(--gold-soft); color: var(--gold-text); border: 1px solid var(--gold-border); border-radius: 18px; margin-bottom: 22px; }.public-tree-welcome h2 { font-size: 21px; font-weight: 650; }.public-tree-welcome p { color: var(--text-secondary); max-width: 520px; margin: 12px auto 30px; line-height: 1.8; font-size: 13px; }.public-tree-welcome > div { display: flex; justify-content: center; gap: 45px; }.public-tree-welcome > div > span { font-size: 23px; font-weight: 650; color: var(--gold-text); }.public-tree-welcome small { display: block; font-size: 11px; font-weight: 400; color: var(--text-secondary); margin-top: 6px; }
@media (max-width: 600px) { .public-tree-nav { min-height: 76px; }.public-tree-nav > div { gap: 7px; }.public-tree-nav .text-link { font-size: 11px; }.public-tree-main { padding-top: 30px; }.public-tree-search, .public-tree-result { padding: 17px; }.public-tree-search .button { flex: 1; }.public-tree-welcome > div { gap: 20px; }.public-tree-welcome > div > span { font-size: 20px; } }
</style>
