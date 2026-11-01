<script setup lang="ts">
const emit = defineEmits<{ connected: [] }>();
const { t } = useLoopI18n();
const { wallet, walletError, walletLoading, refreshWallet } = useEvmWallet();
const { matches } = useConnectedWallet();
await refreshWallet();
async function connected() {
  await refreshWallet();
  emit("connected");
}
</script>

<template>
  <section class="admin-panel" data-testid="admin-wallet-binding">
    <div class="admin-panel-heading">
      <div><h2>{{ t('admin.walletBinding') }}</h2><p>{{ t('admin.walletBindingHint') }}</p></div>
      <AppIcon name="ShieldCheck" :size="22" />
    </div>
    <div class="admin-contract-content">
      <template v-if="walletError">
        <p class="auth-error" role="alert">{{ t('connected.loadFailed') }}</p>
        <button class="admin-text-button" :disabled="walletLoading" @click="refreshWallet()">{{ t('admin.retry') }}</button>
      </template>
      <template v-else-if="wallet">
        <p>{{ t('admin.walletLocked') }}</p>
        <code class="connected-address" data-testid="admin-bound-wallet">{{ wallet.address }}</code>
        <WalletConnector v-if="!matches" purpose="connect" @connected="connected" />
      </template>
      <WalletConnector v-else-if="!walletLoading" purpose="link" @connected="connected" />
    </div>
  </section>
</template>
