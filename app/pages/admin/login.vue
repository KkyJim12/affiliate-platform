<script setup lang="ts">
definePageMeta({ layout: false });
const { t, tr } = useLoopI18n();
const { user } = useAccount();
const external = useRuntimeConfig().public.walletMode !== "embedded";
const legacy = ref(false);
const { errorMessage } = useAdminTools();
const route = useRoute();
const username = ref("");
const password = ref("");
const showPassword = ref(false);
const busy = ref(false);
const error = ref("");
const destination = computed(() => typeof route.query.redirect === "string" && /^\/admin\/(dashboard|users|explorer|payments|settings)(?:\?|$)/.test(route.query.redirect) ? route.query.redirect : "/admin/dashboard");
if (user.value?.role === "admin") await navigateTo(destination.value, { replace: true });
useHead({ title: computed(() => `${t('admin.login')} · UNXO`) });
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const result = await $fetch<{ user: import("../../../shared/types").Account }>("/api/admin/login", { method: "POST", body: { username: username.value, password: password.value } });
    user.value = result.user;
    password.value = "";
    await navigateTo(destination.value, { replace: true });
  } catch (failure) { error.value = errorMessage(failure); }
  finally { busy.value = false; }
}
async function walletSignedIn() {
  if (user.value?.role === "admin") await navigateTo(destination.value, { replace: true });
  else error.value = t('connected.adminRequired');
}
</script>

<template>
  <main class="admin-login-page">
    <header class="admin-login-header"><NuxtLink to="/" aria-label="UNXO"><BrandLogo /></NuxtLink><div><LocaleSwitcher /><ThemeToggle /></div></header>
    <div class="admin-login-grid">
      <section class="admin-login-intro"><span class="admin-eyebrow"><span></span>{{ t('admin.controlCenter') }}</span><h1>{{ t('admin.loginHeadline') }}</h1><p>{{ t('admin.loginDescription') }}</p><div class="admin-login-art" aria-hidden="true"><div class="admin-orbit orbit-one"></div><div class="admin-orbit orbit-two"></div><div class="admin-orbit-core"><BrandLogo symbol /></div><span class="admin-orbit-icon orbit-users"><AppIcon name="Users" :size="25" /></span><span class="admin-orbit-icon orbit-payments"><AppIcon name="Wallet" :size="25" /></span><span class="admin-orbit-icon orbit-security"><AppIcon name="ShieldCheck" :size="25" /></span></div><span class="admin-login-note"><AppIcon name="ShieldCheck" :size="16" />{{ t('admin.authorizedOnly') }}</span></section>
      <section class="admin-login-card"><span class="admin-login-lock"><AppIcon name="LockKeyhole" :size="25" /></span><h2>{{ t('admin.login') }}</h2><p>{{ t(external ? 'connected.adminLoginHint' : 'admin.loginHint') }}</p><template v-if="external"><WalletConnector purpose="login" @connected="walletSignedIn" /><p v-if="error" class="auth-error" role="alert">{{ error }}</p><button class="text-action" @click="legacy = !legacy">{{ t('connected.existingAccount') }}</button></template><form v-if="!external || legacy" class="account-form" @submit.prevent="submit"><label for="admin-username">{{ t('ui.username') }}</label><input id="admin-username" v-model="username" class="auth-input" autocomplete="username" autocapitalize="none" :placeholder="t('admin.usernamePlaceholder')" spellcheck="false" required maxlength="24" :disabled="busy" /><label for="admin-password">{{ t('ui.password') }}</label><div class="password-field"><input id="admin-password" v-model="password" class="auth-input" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" :placeholder="t('ui.enter_your_password')" required maxlength="128" :disabled="busy" /><button type="button" :aria-label="showPassword ? t('ui.hide_password') : t('ui.show_password')" @click="showPassword = !showPassword"><AppIcon :name="showPassword ? 'EyeOff' : 'Eye'" :size="18" /></button></div><p v-if="error" class="auth-error" role="alert">{{ error }}</p><button class="button button-orange" type="submit" :disabled="busy"><AppIcon v-if="busy" name="LoaderCircle" class="auth-loading" :size="17" />{{ busy ? t('ui.please_wait') : t('admin.signIn') }}<AppIcon v-if="!busy" name="ArrowRight" :size="17" /></button></form><div class="admin-login-security"><AppIcon name="ShieldCheck" :size="15" />{{ t('admin.secureSession') }}</div><NuxtLink to="/dashboard" class="admin-back-link"><AppIcon name="ArrowLeft" :size="15" />{{ t('admin.memberWorkspace') }}</NuxtLink></section>
    </div>
    <footer class="admin-login-footer">UNXO · {{ tr('Good connections come full circle.') }}</footer>
  </main>
</template>
