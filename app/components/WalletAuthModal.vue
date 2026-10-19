<script setup lang="ts">
import { normalizeReferralCode } from "#shared/referral-code";
const { t } = useLoopI18n();
const { authOpen } = useAppUI();
const { signIn } = useAccount();
const sponsorCode = ref(""), username = ref(""), password = ref(""), error = ref("");
const legacy = ref(false), busy = ref(false);
watch(authOpen, open => { error.value = ""; password.value = ""; legacy.value = false;
  if (open) sponsorCode.value = normalizeReferralCode(sessionStorage.getItem("loop-incoming-referral") || ""); });
async function signedIn() {
  sessionStorage.removeItem("loop-incoming-referral"); authOpen.value = false; password.value = "";
  await navigateTo("/dashboard");
}
async function migrateAccount() {
  if (busy.value) return;
  busy.value = true; error.value = "";
  try { await signIn(username.value,password.value); authOpen.value = false; password.value = ""; await navigateTo("/dashboard?view=wallet"); }
  catch (failure) { error.value = (failure as { data?: { statusMessage?: string } }).data?.statusMessage || t('connected.loginFailed'); }
  finally { busy.value = false; password.value = ""; }
}
</script>
<template>
  <ModalTransition><AppModal v-if="authOpen" :title="t('connected.signIn')" @close="authOpen = false">
    <div class="auth-modal account-auth">
      <div class="auth-logo"><BrandLogo /></div><h2>{{ t('connected.signIn') }}</h2><p>{{ t('connected.signInHint') }}</p>
      <label for="wallet-invite">{{ t('ui.invite_code') }} · {{ t('ui.optional') }}</label>
      <input id="wallet-invite" v-model="sponsorCode" class="auth-input" maxlength="24" placeholder="UNXO-XXXXXXXX" />
      <WalletConnector purpose="login" :sponsor-code="sponsorCode" @connected="signedIn" />
      <button class="text-action" @click="legacy = !legacy">{{ t('connected.existingAccount') }}</button>
      <form v-if="legacy" class="account-form" @submit.prevent="migrateAccount">
        <p>{{ t('connected.migrationHint') }}</p>
        <label for="legacy-username">{{ t('ui.username') }}</label><input id="legacy-username" v-model="username" class="auth-input" required maxlength="24" autocomplete="username" />
        <label for="legacy-password">{{ t('ui.password') }}</label><input id="legacy-password" v-model="password" type="password" class="auth-input" required maxlength="128" autocomplete="current-password" />
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p><button class="button button-outline" :disabled="busy">{{ t('connected.linkExisting') }}</button>
      </form>
    </div>
  </AppModal></ModalTransition>
</template>
