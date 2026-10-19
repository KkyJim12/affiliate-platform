<script setup lang="ts">
withDefaults(defineProps<{ menu?: boolean; showNative?: boolean; refreshable?: boolean }>(), { menu: false, showNative: false, refreshable: false });
const { t } = useLoopI18n();
const { copy } = useAppUI();
const { wallet, walletError, walletLoading, refreshWallet, balances, balanceError, balanceLoading, refreshBalances, formattedBalance, symbol, balanceTitle } = useWalletSummary();
</script>
<template>
  <div class="account-wallet-summary" :class="{ 'account-wallet-summary-menu': menu }">
    <div class="account-wallet-balance" :title="balanceTitle"><span>{{ t('profileMenu.assetBalance', { symbol }) }}</span><strong data-testid="account-wallet-balance">{{ formattedBalance }} <small>{{ symbol }}</small></strong></div>
    <button v-if="refreshable" class="account-wallet-retry" :disabled="balanceLoading" @click="refreshBalances(true)"><AppIcon name="RefreshCw" :size="13" />{{ t('evmWallet.refresh') }}</button>
    <p v-if="balanceError && !menu" role="status">{{ t('evmWallet.balanceUnavailable') }}</p>
    <p v-if="showNative && balances" class="account-wallet-native">{{ balances.native.balance }} POL · Polygon Amoy</p>
    <span class="account-wallet-label">{{ t('evmWallet.address') }}</span>
    <template v-if="wallet"><span class="account-wallet-network">{{ wallet.network }}</span><button class="account-wallet-address" :role="menu ? 'menuitem' : undefined" :aria-label="t('evmWallet.copyAddress')" @click="copy(wallet.address)"><code :data-testid="menu ? 'profile-wallet-address' : 'connected-wallet-address'">{{ wallet.address }}</code><AppIcon name="Copy" :size="16" /></button></template>
    <p v-else-if="walletLoading" role="status">{{ t('evmWallet.loading') }}</p>
    <template v-else-if="walletError"><p role="status">{{ t('evmWallet.loadFailed') }}</p><button class="account-wallet-retry" :role="menu ? 'menuitem' : undefined" @click="refreshWallet">{{ t('evmWallet.retry') }}</button></template>
    <p v-else>{{ t('profileMenu.noWallet') }}</p>
  </div>
</template>
<style scoped>
.account-wallet-summary { display: grid; gap: 9px; min-width: 0; }
.account-wallet-summary-menu { margin: 0 5px 8px; padding: 12px; border-radius: 10px; background: var(--surface-alt); border: 1px solid var(--border); }
.account-wallet-balance { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.account-wallet-balance > span, .account-wallet-label, .account-wallet-summary p { color: var(--text-secondary); font-size: 12px; line-height: 1.7; }
.account-wallet-balance strong { color: var(--text-primary); font-size: 24px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.account-wallet-balance small { font-size: 11px; font-weight: 500; }
.account-wallet-summary-menu .account-wallet-balance strong { font-size: 12px; }
.account-wallet-summary-menu .account-wallet-balance > span { font-size: 11px; }
.account-wallet-network { color: var(--gold-text); font-size: 11px; font-weight: 650; }
.account-wallet-address { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; text-align: left; color: var(--text-primary); }
.account-wallet-address code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 12px; line-height: 1.7; }
.account-wallet-address svg { flex-shrink: 0; color: var(--gold-text); }
.account-wallet-address:hover, .account-wallet-retry { color: var(--gold-text); }
.account-wallet-retry { justify-self: start; font-size: 12px; text-decoration: underline; }
</style>
