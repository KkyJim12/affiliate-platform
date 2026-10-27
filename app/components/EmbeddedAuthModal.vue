<script setup lang="ts">
const { t, tr, localeTag, formatDate } = useLoopI18n();

const { authOpen, notify } = useAppUI();
const { signIn, register } = useAccount();
const { incomingReferral } = useIncomingReferral();
const mode = ref<"login" | "register">("login");
const memberId = ref("");
const password = ref("");
const confirmation = ref("");
const sponsorCode = ref("");
const showPassword = ref(false);
const loading = ref(false);
const error = ref("");
watch(authOpen, (open) => {
  error.value = "";
  password.value = "";
  confirmation.value = "";
  showPassword.value = false;
  if (open) sponsorCode.value = incomingReferral();
});
watch(mode, () => { error.value = ""; password.value = ""; confirmation.value = ""; });
async function submit() {
  if (loading.value) return;
  error.value = "";
  if (mode.value === "register" && password.value !== confirmation.value) {
    error.value = "Your passwords do not match.";
    return;
  }
  loading.value = true;
  try {
    const incomingReferral = sessionStorage.getItem("loop-incoming-referral");
    if (mode.value === "register") {
      await register(password.value, sponsorCode.value);
      sessionStorage.removeItem("loop-incoming-referral");
    } else await signIn(memberId.value, password.value);
    password.value = "";
    confirmation.value = "";
    authOpen.value = false;
    notify(mode.value === "register" ? t('profile.accountCreated', { memberId: useAccount().user.value?.memberId }) : "Welcome back to your loop.");
    await navigateTo(incomingReferral ? "/referrals" : "/dashboard");
  } catch (err) {
    const failure = err as { data?: { statusMessage?: string } };
    error.value = failure.data?.statusMessage || "We could not sign you in. Please try again.";
  } finally { loading.value = false; }
}
</script>

<template>
  <ModalTransition><AppModal v-if="authOpen" :title="mode === 'login' ? t('ui.sign_in_to_loop') : t('ui.create_your_loop_account')" @close="authOpen = false">
    <div class="auth-modal account-auth">
      <div class="auth-logo"><BrandLogo /></div>
      <div class="auth-tabs" :aria-label="t('ui.account_access')">
        <button :class="{ selected: mode === 'login' }" :disabled="loading" @click="mode = 'login'">{{ t('ui.sign_in') }}</button>
        <button :class="{ selected: mode === 'register' }" :disabled="loading" @click="mode = 'register'">{{ t('ui.create_account') }}</button>
      </div>
      <h2>{{ mode === 'login' ? t('ui.back_in_good_company') : t('ui.your_next_chapter_starts_here') }}</h2>
      <p>{{ mode === 'login' ? t('ui.sign_in_to_your_network_and_in_app_wallet') : t('ui.one_account_for_your_matrix_referrals_and_usdt_wallet') }}</p>
      <form class="account-form" @submit.prevent="submit">
        <template v-if="mode === 'login'">
          <label for="login-member-id">{{ t('publicTree.memberId') }}</label>
          <input id="login-member-id" v-model="memberId" class="auth-input" autocomplete="username" inputmode="numeric" :placeholder="t('publicTree.placeholder')" required maxlength="16" pattern="[1-9][0-9]{0,15}" :disabled="loading" />
        </template>
        <p v-else>{{ t('profile.autoIdHint') }}</p>
        <label for="login-password">{{ t('ui.password') }}</label>
        <div class="password-field">
          <input id="login-password" v-model="password" class="auth-input" :type="showPassword ? 'text' : 'password'" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" :minlength="mode === 'register' ? 12 : 1" maxlength="128" :placeholder="mode === 'login' ? t('ui.enter_your_password') : t('ui.at_least_12_characters')" required :disabled="loading" />
          <button type="button" :aria-label="showPassword ? t('ui.hide_password') : t('ui.show_password')" @click="showPassword = !showPassword"><AppIcon :name="showPassword ? 'EyeOff' : 'Eye'" :size="17" /></button>
        </div>
        <template v-if="mode === 'register'">
          <label for="confirm-password">{{ t('ui.confirm_password') }}</label>
          <input id="confirm-password" v-model="confirmation" class="auth-input" type="password" autocomplete="new-password" :placeholder="t('ui.enter_your_password_again')" required minlength="12" maxlength="128" :disabled="loading" />
        </template>
        <label for="sponsor-code">{{ t('ui.invite_code') }} <span>{{ t('ui.optional') }}</span></label>
        <input id="sponsor-code" v-model="sponsorCode" class="auth-input" :placeholder="t('publicTree.placeholder')" maxlength="24" :disabled="loading" autocomplete="off" autocapitalize="characters" spellcheck="false" />
        <p v-if="error" class="auth-error" role="alert">{{ tr(error) }}</p>
        <button class="button button-orange auth-wallet-button" type="submit" :disabled="loading"><AppIcon v-if="loading" name="LoaderCircle" class="auth-loading" :size="17" />{{ loading ? t('ui.please_wait') : mode === 'login' ? t('ui.sign_in_to_loop') : t('ui.create_account_wallet') }}<AppIcon v-if="!loading" name="ArrowRight" :size="17" /></button>
      </form>
      <div class="auth-security"><AppIcon name="ShieldCheck" :size="15" />{{ t('ui.password_protected_your_wallet_is_included') }}</div>
      <NuxtLink class="auth-demo-link" to="/dashboard" @click="authOpen = false">{{ t('ui.explore_the_plan_preview') }}<AppIcon name="ArrowUpRight" :size="15" /></NuxtLink>
    </div>
  </AppModal></ModalTransition>
</template>
