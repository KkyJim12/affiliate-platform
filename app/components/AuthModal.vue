<script setup lang="ts">
import { passwordLoginEnabled } from "#shared/auth-mode";
const config = useRuntimeConfig().public;
const external = config.walletMode !== "embedded";
const credentialsEnabled = passwordLoginEnabled(config.passwordLoginEnabled);
const { authOpen } = useAppUI();
const { t } = useLoopI18n();
</script>
<template>
  <WalletAuthModal v-if="external" />
  <EmbeddedAuthModal v-else-if="credentialsEnabled" />
  <ModalTransition v-else>
    <AppModal v-if="authOpen" :title="t('connected.signIn')" @close="authOpen = false">
      <p class="auth-error" role="alert">{{ t('connected.signInUnavailable') }}</p>
    </AppModal>
  </ModalTransition>
</template>
