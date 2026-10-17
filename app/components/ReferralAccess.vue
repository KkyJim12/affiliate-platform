<script setup lang="ts">
import { formatUsdt } from "#shared/plan";
import { referralPrice, type ReferralProgram, type ReferralUpdate } from "#shared/referral";

const props = defineProps<{ preview?: boolean }>();
const emit = defineEmits<{ updated: [] }>();
const { t, tr, formatDate } = useLoopI18n();
const { user } = useAccount();
const { wallet } = useWallet();
const { authOpen, copy, notify } = useAppUI();
const config = useRuntimeConfig();
const route = useRoute();
const origin = useRequestURL().origin;
const code = ref(typeof route.query.ref === "string" ? route.query.ref.slice(0, 24) : "");
const purchaseOpen = ref(false);
const password = ref("");
const requestKey = ref("");
const busy = ref(false);
const actionError = ref("");
const purchaseError = ref("");
const { data: program, error, status, refresh } = await useFetch<ReferralProgram>("/api/referrals/program", { key: `referral-program-${user.value?.id || 'guest'}`, immediate: !props.preview });
const price = computed(() => program.value?.price ?? referralPrice);
const available = computed(() => wallet.value?.available ?? 0);
const canAfford = computed(() => !!wallet.value && available.value >= price.value);
const inviteLink = computed(() => program.value?.code ? `${String(config.public.appUrl || origin).replace(/\/$/, "")}/referrals?ref=${program.value.code}` : "");

onMounted(() => {
  if (/^LOOP-[a-z0-9]{8}$/i.test(code.value)) sessionStorage.setItem("loop-incoming-referral", code.value.toUpperCase());
  else if (!code.value) code.value = sessionStorage.getItem("loop-incoming-referral") || "";
});
function openPurchase() {
  if (props.preview) { authOpen.value = true; return; }
  password.value = "";
  purchaseError.value = "";
  requestKey.value = crypto.randomUUID();
  purchaseOpen.value = true;
}
function closePurchase() { if (!busy.value) { purchaseOpen.value = false; password.value = ""; } }
function applyResult(result: ReferralUpdate) {
  user.value = result.user;
  wallet.value = result.wallet;
  program.value = result.program;
  emit("updated");
}
async function activate() {
  if (busy.value) return;
  busy.value = true;
  purchaseError.value = "";
  try {
    applyResult(await $fetch<ReferralUpdate>("/api/referrals/activate", { method: "POST", body: { password: password.value, requestKey: requestKey.value } }));
    purchaseOpen.value = false;
    password.value = "";
    notify(t("referral.activated"));
  } catch (failure) {
    purchaseError.value = (failure as { data?: { statusMessage?: string } }).data?.statusMessage || t("referral.actionFailed");
  } finally { busy.value = false; }
}
async function connectSponsor() {
  if (props.preview) {
    if (/^LOOP-[a-z0-9]{8}$/i.test(code.value.trim())) sessionStorage.setItem("loop-incoming-referral", code.value.trim().toUpperCase());
    authOpen.value = true;
    return;
  }
  if (busy.value) return;
  busy.value = true;
  actionError.value = "";
  try {
    applyResult(await $fetch<ReferralUpdate>("/api/referrals/sponsor", { method: "POST", body: { code: code.value } }));
    sessionStorage.removeItem("loop-incoming-referral");
    notify(t("referral.sponsorConnected"));
  } catch (failure) {
    actionError.value = (failure as { data?: { statusMessage?: string } }).data?.statusMessage || t("referral.actionFailed");
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="referral-access">
    <div v-if="!preview && error" class="referral-access-error" role="alert"><p>{{ t('referral.loadFailed') }}</p><button class="text-action" @click="refresh()">{{ t('admin.retry') }}</button></div>
    <p v-else-if="!preview && !program" class="referral-access-loading" role="status">{{ t('explorer.loading') }}</p>
    <template v-else>
      <section class="panel referral-code-card" :class="{ 'referral-code-active': program?.code }">
        <div class="referral-card-top"><span class="referral-access-icon"><AppIcon :name="program?.code ? 'CheckCircle2' : 'LockKeyhole'" :size="23" /></span><span class="referral-access-badge">{{ program?.code ? t('referral.active') : t('referral.oneTime') }}</span></div>
        <template v-if="program?.code">
          <span class="eyebrow">{{ t('referral.yourCode') }}</span>
          <h2 class="referral-personal-code" data-testid="referral-code">{{ program.code }}</h2>
          <p>{{ t('referral.shareHint') }}</p>
          <div class="referral-code-actions"><button class="button button-orange" @click="copy(program.code, t('referral.codeCopied'))"><AppIcon name="Copy" :size="15" />{{ t('referral.copyCode') }}</button><button class="button button-outline" @click="copy(inviteLink, t('referral.linkCopied'))"><AppIcon name="Link" :size="15" />{{ t('ui.copy_link') }}</button></div>
          <div class="referral-link-preview"><AppIcon name="Link" :size="14" /><span>{{ inviteLink }}</span></div>
          <span v-if="program.activatedAt" class="referral-card-note">{{ t('referral.activatedOn', { date: formatDate(program.activatedAt) }) }}</span>
        </template>
        <template v-else>
          <span class="eyebrow">{{ t('referral.unlockEyebrow') }}</span>
          <h2>{{ t('referral.unlockTitle') }}</h2>
          <p>{{ t('referral.unlockHint') }}</p>
          <div class="referral-price"><strong>{{ formatUsdt(price) }}</strong><span>USDT<small>{{ t('referral.oneTime') }}</small></span></div>
          <div v-if="!preview" class="referral-balance"><span>{{ t('ui.available_balance') }}</span><strong>{{ formatUsdt(available) }} USDT</strong></div>
          <button class="button button-orange referral-unlock-button" :disabled="!preview && (!canAfford || busy || status === 'pending')" @click="openPurchase">{{ preview ? t('ui.sign_in') : t('referral.buy', { amount: formatUsdt(price) }) }}<AppIcon name="ArrowRight" :size="16" /></button>
          <p v-if="!preview && !canAfford" class="referral-funding-hint">{{ t('referral.fundingHint') }} <NuxtLink to="/dashboard?view=wallet">{{ t('referral.addFunds') }}<AppIcon name="ArrowUpRight" :size="13" /></NuxtLink></p>
          <span class="referral-card-note"><AppIcon name="ShieldCheck" :size="14" />{{ t('referral.purchaseNote') }}</span>
        </template>
      </section>

      <section class="panel referral-sponsor-card">
        <div class="referral-card-top"><span class="referral-access-icon"><AppIcon name="Users" :size="23" /></span><span class="referral-access-badge">{{ program?.sponsor ? t('referral.connected') : t('referral.joinEyebrow') }}</span></div>
        <h2>{{ t('referral.sponsorTitle') }}</h2>
        <template v-if="program?.sponsor">
          <p>{{ t('referral.sponsorLinkedHint') }}</p>
          <div class="referral-sponsor-identity"><span>{{ program.sponsor.username.slice(0, 2).toUpperCase() }}</span><div><strong data-testid="referral-sponsor">@{{ program.sponsor.username }}</strong><small>{{ program.sponsor.code }}</small></div><AppIcon name="CheckCircle2" :size="21" /></div>
          <p class="referral-card-note">{{ t('referral.sponsorPermanent') }}</p>
          <NuxtLink to="/explorer" class="inline-link">{{ t('referral.exploreNetwork') }}<AppIcon name="ArrowUpRight" :size="14" /></NuxtLink>
        </template>
        <template v-else>
          <p>{{ t('referral.sponsorHint') }}</p>
          <form class="account-form referral-sponsor-form" @submit.prevent="connectSponsor">
            <label for="referral-sponsor-code">{{ t('referral.enterCode') }}</label>
            <input id="referral-sponsor-code" v-model="code" class="auth-input" placeholder="LOOP-XXXXXXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" required :disabled="busy" />
            <p v-if="actionError" class="auth-error" role="alert">{{ tr(actionError) }}</p>
            <button class="button button-outline" type="submit" :disabled="busy"><AppIcon v-if="busy" name="LoaderCircle" class="auth-loading" :size="16" />{{ preview ? t('ui.sign_in') : t('referral.useCode') }}<AppIcon v-if="!busy" name="ArrowRight" :size="16" /></button>
          </form>
          <p class="referral-card-note"><AppIcon name="Info" :size="14" />{{ t('referral.sponsorPermanent') }}</p>
          <span class="referral-sponsor-free">{{ t('referral.freeToConnect') }}</span>
        </template>
      </section>
    </template>

    <AppModal v-if="purchaseOpen" :title="t('referral.confirmTitle')" @close="closePurchase">
      <div class="admin-dialog referral-purchase-dialog"><span class="admin-dialog-icon"><AppIcon name="LockKeyhole" :size="25" /></span><h2>{{ t('referral.confirmTitle') }}</h2><p>{{ t('referral.confirmHint') }}</p><dl class="admin-details"><div><dt>{{ t('referral.activationFee') }}</dt><dd>{{ formatUsdt(price) }} USDT</dd></div><div><dt>{{ t('ui.available_balance') }}</dt><dd>{{ formatUsdt(available) }} USDT</dd></div><div><dt>{{ t('referral.balanceAfter') }}</dt><dd>{{ formatUsdt(Math.max(0, available - price)) }} USDT</dd></div></dl><form class="account-form" @submit.prevent="activate"><label for="referral-purchase-password">{{ t('ui.confirm_with_your_password') }}</label><input id="referral-purchase-password" v-model="password" class="auth-input" type="password" autocomplete="current-password" required maxlength="128" :disabled="busy" /><p v-if="purchaseError" class="auth-error" role="alert">{{ tr(purchaseError) }}</p><button class="button button-orange" type="submit" :disabled="busy || !canAfford"><AppIcon v-if="busy" name="LoaderCircle" class="auth-loading" :size="16" />{{ busy ? t('ui.please_wait') : t('referral.confirmPay', { amount: formatUsdt(price) }) }}</button></form></div>
    </AppModal>
  </div>
</template>
