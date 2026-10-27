<script setup lang="ts">
import { passwordLoginEnabled } from "#shared/auth-mode";
const credentialsEnabled = passwordLoginEnabled(useRuntimeConfig().public.passwordLoginEnabled);
const { t } = useLoopI18n();
const { authOpen } = useAppUI();
const { signIn } = useAccount();
const { incomingReferral } = useIncomingReferral();
const sponsorCode = ref(""), memberId = ref(""), password = ref(""), error = ref("");
const legacy = ref(false), busy = ref(false);
watch(authOpen, open => { error.value = ""; password.value = ""; legacy.value = false;
  if (open) {
    sponsorCode.value = incomingReferral();
  } });
async function signedIn() {
  sessionStorage.removeItem("loop-incoming-referral"); authOpen.value = false; password.value = "";
  await navigateTo("/dashboard");
}
async function migrateAccount() {
  if (!credentialsEnabled || busy.value) return;
  busy.value = true; error.value = "";
  try { await signIn(memberId.value,password.value); authOpen.value = false; password.value = ""; await navigateTo("/wallet"); }
  catch (failure) { error.value = (failure as { data?: { statusMessage?: string } }).data?.statusMessage || t('connected.loginFailed'); }
  finally { busy.value = false; password.value = ""; }
}
</script>
<template>
  <ModalTransition><AppModal v-if="authOpen" :title="t('connected.connectTitle')" variant="wallet" @close="authOpen = false">
    <div class="wallet-auth">
      <div class="wallet-auth-brand"><BrandLogo /><span class="wallet-auth-network"><span aria-hidden="true"></span>Polygon Amoy</span></div>
      <div class="wallet-auth-heading"><h2>{{ t('connected.connectTitle') }}</h2><p>{{ t('connected.connectHint') }}</p></div>
      <WalletConnector purpose="login" :sponsor-code="sponsorCode" :show-heading="false" @connected="signedIn" />
      <div class="wallet-invite is-open">
        <div id="wallet-invite-field" class="wallet-invite-field"><label for="wallet-invite"><AppIcon name="Gift" :size="16" />{{ t('ui.invite_code') }} <span>{{ t('ui.optional') }}</span></label><input id="wallet-invite" v-model="sponsorCode" class="auth-input" maxlength="24" :placeholder="t('publicTree.placeholder')" autocomplete="off" autocapitalize="characters" spellcheck="false" /></div>
      </div>
      <div class="wallet-auth-security"><span class="wallet-auth-security-icon"><AppIcon name="ShieldCheck" :size="19" /></span><p><strong>{{ t('connected.yourWalletYourKeys') }}</strong><span>{{ t('connected.signatureOnly') }}</span></p></div>
      <button v-if="credentialsEnabled" type="button" class="text-action wallet-legacy-toggle" :aria-expanded="legacy" @click="legacy = !legacy">{{ t('connected.existingAccount') }}</button>
      <form v-if="credentialsEnabled && legacy" class="account-form" @submit.prevent="migrateAccount">
        <p>{{ t('connected.migrationHint') }}</p>
        <label for="legacy-memberId">{{ t('ui.memberId') }}</label><input id="legacy-memberId" v-model="memberId" class="auth-input" required inputmode="numeric" pattern="[1-9][0-9]{0,15}" maxlength="16" autocomplete="username" />
        <label for="legacy-password">{{ t('ui.password') }}</label><input id="legacy-password" v-model="password" type="password" class="auth-input" required maxlength="128" autocomplete="current-password" />
        <p v-if="error" class="auth-error" role="alert">{{ error }}</p><button class="button button-outline" :disabled="busy">{{ t('connected.linkExisting') }}</button>
      </form>
    </div>
  </AppModal></ModalTransition>
</template>
