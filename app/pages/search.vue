<script setup lang="ts">
import { isMemberId } from "#shared/referral-code";
definePageMeta({ alias: ['/tree'] });
const { t } = useLoopI18n();
const route = useRoute();
const { user } = useAccount();
const input = ref(typeof route.query.id === 'string' ? route.query.id : '');
const submitted = computed(() => typeof route.query.id === 'string' ? route.query.id.trim() : '');
const invalid = ref(false);
const layout = ref<'matrix' | 'unilevel'>('matrix');
watch(() => route.query.id, () => { input.value = submitted.value; invalid.value = !!submitted.value && !isMemberId(submitted.value); layout.value = 'matrix'; }, { immediate: true });
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
      <form class="public-tree-search panel" @submit.prevent="search">
        <div>
          <label for="public-member-id">{{ t('publicTree.memberId') }}</label>
          <div class="public-tree-input" :class="{ 'is-invalid': invalid }">
            <span class="public-tree-search-icon"><AppIcon name="Search" :size="18" /></span>
            <input id="public-member-id" v-model="input" inputmode="numeric" maxlength="16" autocomplete="off" :placeholder="t('publicTree.placeholder')" :aria-invalid="invalid" :aria-describedby="invalid ? 'member-id-error' : undefined" />
          </div>
        </div>
        <button class="button button-orange" type="submit">{{ t('publicTree.search') }}<AppIcon name="ArrowRight" :size="17" /></button>
        <NuxtLink v-if="user?.memberId" :to="{ path: '/search', query: { id: user.memberId } }" class="text-link">{{ t('publicTree.myTree', { id: user.memberId }) }}</NuxtLink>
        <p v-if="invalid" id="member-id-error" class="auth-error" role="alert">{{ t('publicTree.invalidId') }}</p>
      </form>
      <div v-if="submitted && !invalid" class="panel public-tree-result">
        <div class="public-member-heading"><h2>{{ t('publicTree.memberTitle',{id:submitted}) }}</h2><p>{{ t(layout === 'unilevel' ? 'unilevelSlots.hint' : 'matrixSlots.hint') }}</p></div>
        <div class="public-tree-views" role="group" :aria-label="t('ui.referral_view')">
          <button class="button button-outline button-small" :aria-pressed="layout === 'matrix'" @click="layout = 'matrix'">{{ t('matrixSlots.nav') }}</button>
          <button class="button button-outline button-small" :aria-pressed="layout === 'unilevel'" @click="layout = 'unilevel'">{{ t('matrix.unilevel') }}</button>
        </div>
        <MatrixSlots v-if="layout === 'matrix'" :key="submitted" :member-id="submitted" public-view />
        <MatrixSlots v-else :key="`unilevel-${submitted}`" :member-id="submitted" program="unilevel" public-view />
      </div>
      <div v-else class="public-tree-welcome panel"><span class="public-tree-symbol"><AppIcon name="GitFork" :size="36" /></span><h2>{{ t('publicTree.welcomeTitle') }}</h2><p>{{ t('publicTree.welcomeHint') }}</p><div><span>15 <small>{{ t('publicTree.steps') }}</small></span></div></div>
    </main>
  </div>
</template>

<style scoped>
.public-tree-page .panel { background: var(--surface); border-color: var(--border); }
.public-tree-page { min-height: 100vh; background: var(--canvas); }.public-tree-nav { display: flex; justify-content: space-between; align-items: center; gap: 16px; min-height: 92px; border-bottom: 1px solid var(--border); }.public-tree-nav > div { display: flex; align-items: center; gap: 15px; }.public-tree-nav :deep(.brand-logo) { --brand-height: 38px; }
.public-tree-main { padding-top: 48px; padding-bottom: 60px; }.public-tree-intro { margin-bottom: 28px; }.public-tree-intro .eyebrow { display: flex; align-items: center; gap: 8px; }.public-tree-intro h1 { font-size: clamp(27px, 4vw, 40px); font-weight: 750; margin: 12px 0; letter-spacing: -1px; }.public-tree-intro p { color: var(--text-secondary); max-width: 680px; line-height: 1.8; font-size: 14px; }
.public-tree-search { display: flex; align-items: end; gap: 14px; flex-wrap: wrap; padding: 24px; margin-bottom: 24px; }
.public-tree-search > div { flex: 1; min-width: 180px; max-width: 420px; }
.public-tree-search label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 9px; }
.public-tree-input { position: relative; border: 1px solid var(--border); background: var(--surface-alt); border-radius: 12px; transition: border-color .18s, background-color .18s, box-shadow .18s; }
.public-tree-search-icon { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--border); border-radius: 8px; color: var(--text-tertiary); background: var(--surface); pointer-events: none; transition: color .18s, background-color .18s, border-color .18s; }
.public-tree-input input { display: block; min-width: 0; width: 100%; min-height: 54px; padding: 14px 16px 14px 56px; border: 0; border-radius: inherit; background: transparent; color: var(--text-primary); caret-color: var(--gold-text); font-size: 14px; font-weight: 500; line-height: 1.5; font-variant-numeric: tabular-nums; }
.public-tree-input input::placeholder { color: var(--text-tertiary); font-weight: 400; opacity: 1; }
.public-tree-input input:focus, .public-tree-input input:focus-visible { outline: none; box-shadow: none; }
@media (hover: hover) {
  .public-tree-input:hover { border-color: var(--gold-border); background: var(--surface); box-shadow: 0 4px 16px var(--gold-glow); }
  .public-tree-input:hover .public-tree-search-icon { color: var(--gold-text); background: var(--gold-soft); border-color: var(--gold-border); }
}
.public-tree-input:focus-within { border-color: var(--gold-text); background: var(--surface); box-shadow: 0 0 0 1px var(--gold-text), 0 0 0 4px color-mix(in srgb, var(--gold) 14%, transparent); }
.public-tree-input:focus-within .public-tree-search-icon { color: var(--gold-text); background: var(--gold-soft); border-color: var(--gold-border); }
.public-tree-input.is-invalid { border-color: var(--danger); background: var(--danger-soft); box-shadow: none; }
.public-tree-input.is-invalid .public-tree-search-icon { color: var(--danger); border-color: var(--danger); background: var(--surface); }
.public-tree-input.is-invalid:focus-within { box-shadow: 0 0 0 1px var(--danger), 0 0 0 4px color-mix(in srgb, var(--danger) 12%, transparent); }
.public-tree-search > .button { min-height: 56px; border-radius: 12px; }
.public-tree-search > .text-link { padding: 17px 0; font-size: 12px; }
.public-tree-search > .auth-error { width: 100%; }
.public-member-heading h2 { font-size: 21px; font-weight: 650; overflow-wrap: anywhere; }.public-member-heading p { margin-top: 9px; color: var(--text-secondary); font-size: 12px; line-height: 1.8; }.public-tree-views { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0; }.public-tree-views [aria-pressed='true'] { color: var(--gold-text); border-color: var(--gold-border); background: var(--gold-soft); }
.public-tree-result { padding: 26px; }.public-tree-welcome { padding: 52px 24px; text-align: center; }.public-tree-symbol { display: inline-flex; padding: 18px; background: var(--gold-soft); color: var(--gold-text); border: 1px solid var(--gold-border); border-radius: 18px; margin-bottom: 22px; }.public-tree-welcome h2 { font-size: 21px; font-weight: 650; }.public-tree-welcome p { color: var(--text-secondary); max-width: 520px; margin: 12px auto 30px; line-height: 1.8; font-size: 13px; }.public-tree-welcome > div { display: flex; justify-content: center; gap: 45px; }.public-tree-welcome > div > span { font-size: 23px; font-weight: 650; color: var(--gold-text); }.public-tree-welcome small { display: block; font-size: 11px; font-weight: 400; color: var(--text-secondary); margin-top: 6px; }
@media (max-width: 600px) { .public-tree-nav { min-height: 76px; }.public-tree-nav > div { gap: 7px; }.public-tree-nav .text-link { font-size: 11px; }.public-tree-main { padding-top: 30px; }.public-tree-search, .public-tree-result { padding: 17px; }.public-tree-search .button { flex: 1; }.public-tree-welcome > div { gap: 20px; }.public-tree-welcome > div > span { font-size: 20px; } }
@media (max-width: 600px) { .public-tree-input input { font-size: 16px; } }
@media (forced-colors: active) { .public-tree-input:focus-within { outline: 2px solid Highlight; outline-offset: 2px; } }
</style>
