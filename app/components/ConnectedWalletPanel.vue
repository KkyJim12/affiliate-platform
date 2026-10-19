<script setup lang="ts">
withDefaults(defineProps<{ preview?: boolean; compact?: boolean }>(), { preview: false, compact: false });
const { t } = useLoopI18n();
const { user } = useAccount();
const { authOpen, copy } = useAppUI();
const { wallet, walletError, refreshWallet, balances, balanceLoading, balanceError, refreshBalances } = useEvmWallet();
const { address, matches, walletName } = useConnectedWallet();
const { recover } = useWalletTransactions();
const details = ref(false), sendOpen = ref(false);
async function refresh() { await recover(); await refreshWallet(); if (wallet.value) await refreshBalances(true); }
onMounted(() => { void refresh(); });
watch(() => user.value?.id, () => { details.value = false; sendOpen.value = false; void refresh(); });
</script>
<template>
  <section class="panel wallet-panel connected-wallet-panel" :class="{ 'wallet-panel-compact': compact }" data-testid="connected-wallet-panel">
    <div class="panel-heading"><div><h2>{{ t('connected.walletTitle') }}</h2><p>{{ t('connected.walletHint') }}</p></div><AppIcon name="Wallet" :size="24" /></div>
    <template v-if="wallet && !preview">
      <div class="wallet-balance"><strong>{{ balances?.token?.balance ?? '—' }}</strong><span>{{ balances?.token?.symbol ?? 'USDT' }}</span></div>
      <p>{{ balances?.native.balance ?? '—' }} POL · Polygon Amoy</p>
      <code class="connected-address">{{ wallet.address }}</code>
      <p v-if="matches" class="wallet-network">{{ t('connected.connectedAs', { name: walletName }) }}</p>
      <p v-else-if="address" class="auth-error" role="status">{{ t('connected.wrongAccount') }}</p>
      <WalletConnector v-if="!matches" @connected="refresh" />
      <div class="wallet-actions">
        <button class="button button-orange" :disabled="!matches" @click="sendOpen = true"><AppIcon name="ArrowUpRight" :size="16" />{{ t('evmSend.title') }}</button>
        <button class="button button-outline" aria-haspopup="dialog" @click="details = true">{{ t('evmWallet.details') }}</button>
      </div>
      <button class="text-action" :disabled="balanceLoading" @click="refresh">{{ t('evmWallet.refresh') }}</button>
      <p v-if="balanceError" class="auth-error" role="status">{{ t('evmWallet.balanceUnavailable') }}</p>
    </template>
    <template v-else-if="user && !preview"><p>{{ t('connected.linkHint') }}</p><WalletConnector purpose="link" @connected="refresh" /></template>
    <template v-else><p>{{ t('connected.signInHint') }}</p><button class="button button-orange" @click="authOpen = true">{{ t('connected.signIn') }}</button></template>
    <p v-if="walletError" class="auth-error" role="status">{{ t('connected.loadFailed') }}</p>
  </section>
  <ConnectedWalletSend v-if="user && !preview && wallet" :key="user.id" :open="sendOpen" @close="sendOpen = false" />
  <ModalTransition><AppModal v-if="details && wallet" :title="t('evmWallet.details')" @close="details = false">
    <div class="wallet-action-modal"><h2>{{ t('evmWallet.details') }}</h2><p>{{ t('connected.walletHint') }}</p>
      <dl class="admin-details"><div><dt>{{ t('evmWallet.address') }}</dt><dd class="connected-address">{{ wallet.address }}</dd></div><div><dt>{{ t('onchain.network') }}</dt><dd>Polygon Amoy · 80002</dd></div></dl>
      <button class="button button-outline" @click="copy(wallet.address)">{{ t('connected.copyAddress') }}</button>
      <a class="inline-link" :href="wallet.explorerUrl" target="_blank" rel="noopener noreferrer">{{ t('connected.viewExplorer') }}<AppIcon name="ArrowUpRight" :size="14" /></a>
    </div>
  </AppModal></ModalTransition>
</template>
