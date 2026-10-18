<script setup lang="ts">
import type { EvmWalletDetails } from "#shared/evm-wallet";

const { t, tr, localeTag } = useLoopI18n();
const { user } = useAccount();
const props = withDefaults(defineProps<{ preview?: boolean; compact?: boolean }>(), { preview: false, compact: false });
const { copy, authOpen } = useAppUI();
const { wallet, walletError: loadError, balances, balanceLoading, balanceError, refreshBalances } = useEvmWallet();
const fetching = ref(true);

const dialog = ref<"create" | "reveal" | "receive" | null>(null);
const detailsOpen = ref(false);
const asset = computed(() => balances.value?.token ?? balances.value?.native);
function formatBalance(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  const decimal = new Intl.NumberFormat(localeTag.value).formatToParts(1.1).find(part => part.type === "decimal")?.value ?? ".";
  return new Intl.NumberFormat(localeTag.value).format(BigInt(whole)) + decimal + fraction.slice(0, 6).padEnd(2, "0");
}
function showDetails() {
  if (props.preview) { authOpen.value = true; return; }
  detailsOpen.value = !detailsOpen.value;
}
const password = ref("");
const privateKey = ref("");
const privateKeyField = ref<HTMLTextAreaElement | null>(null);
const error = ref("");
const busy = ref(false);
let loadVersion = 0;
let operationVersion = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function clearSecret() {
  // ModalTransition retains the leaving DOM; blank the field before its fade.
  if (privateKeyField.value) privateKeyField.value.value = "";
  privateKey.value = "";
  password.value = "";
  clearTimeout(hideTimer);
}
function close() {
  operationVersion++;
  clearSecret();
  dialog.value = null;
  error.value = "";
  busy.value = false;
}
function open(action: "create" | "reveal" | "receive") {
  if (props.preview) { authOpen.value = true; return; }
  close();
  dialog.value = action;
}
async function load() {
  const version = ++loadVersion;
  const accountId = user.value?.id;
  wallet.value = null;
  loadError.value = false;
  fetching.value = true;
  try {
    if (!accountId) return;
    const result = await $fetch<{ wallet: EvmWalletDetails | null }>("/api/wallet/evm");
    if (version === loadVersion && user.value?.id === accountId) {
      wallet.value = result.wallet;
      if (wallet.value) void refreshBalances();
    }
  } catch {
    if (version === loadVersion) loadError.value = true;
  } finally {
    if (version === loadVersion) fetching.value = false;
  }
}
async function submit() {
  if (busy.value || !dialog.value || dialog.value === "receive" || !user.value) return;
  const version = ++operationVersion;
  const accountId = user.value.id;
  const action = dialog.value;
  busy.value = true;
  error.value = "";
  try {
    if (action === "create") {
      const result = await $fetch<{ wallet: EvmWalletDetails }>("/api/wallet/evm", { method: "POST", body: { password: password.value } });
      if (version !== operationVersion || user.value?.id !== accountId) return;
      wallet.value = result.wallet;
      void refreshBalances();
      close();
    } else {
      // Keep secrets out of useState, useFetch, SSR payloads and persistent storage.
      const result = await $fetch<{ privateKey: string }>("/api/wallet/evm/reveal", { method: "POST", body: { password: password.value } });
      if (version !== operationVersion || user.value?.id !== accountId) return;
      privateKey.value = result.privateKey;
      hideTimer = setTimeout(close, 30_000);
    }
  } catch (err) {
    if (version === operationVersion) error.value = (err as { data?: { statusMessage?: string } }).data?.statusMessage || t("evmWallet.requestFailed");
  } finally {
    if (version === operationVersion) { password.value = ""; busy.value = false; }
  }
}
function onVisibilityChange() { if (document.hidden) close(); }
watch(() => user.value?.id, () => { close(); detailsOpen.value = false; void load(); }, { flush: "sync" });
onMounted(() => {
  void load();
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", close);
});
onBeforeUnmount(() => {
  close();
  loadVersion++;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pagehide", close);
});
</script>

<template>
  <section class="wallet-section" :class="{ 'wallet-compact': compact }" data-testid="evm-wallet" :aria-label="t('evmWallet.title')">
    <div class="balance-card evm-balance-card">
      <div class="balance-top"><span><AppIcon name="Wallet" :size="18" />{{ t('evmWallet.title') }}</span><span class="wallet-currency"><UsdtIcon v-if="asset?.symbol === 'USDT'" /><AppIcon v-else name="Wallet" :size="14" />{{ asset?.symbol || 'POL' }}</span></div>
      <p class="balance-label">{{ t('evmWallet.onchainBalance') }}</p>
      <div class="balance-amount" data-testid="wallet-balance" :aria-busy="balanceLoading">{{ asset ? formatBalance(asset.balance) : '—' }}<span>{{ asset?.symbol || 'POL' }}</span></div>
      <p v-if="balances?.token" class="evm-gas-balance">{{ t('evmWallet.gasToken') }}: {{ formatBalance(balances.native.balance) }} {{ balances.native.symbol }}</p>
      <div class="wallet-id evm-wallet-address"><code v-if="wallet && !preview" data-testid="evm-address">{{ wallet.address }}</code><span v-else>{{ preview ? t('evmWallet.previewHint') : fetching ? t('evmWallet.loading') : t('evmWallet.createHint') }}</span><button v-if="wallet && !preview" :aria-label="t('evmWallet.copyAddress')" @click="copy(wallet.address)"><AppIcon name="Copy" :size="14" /></button></div>
      <div v-if="wallet && !preview" class="evm-network-line"><span>{{ wallet.network }} · {{ wallet.chainId }}</span><span v-if="wallet.testnet" class="evm-testnet-badge">{{ t('evmWallet.testnet') }}</span><button class="evm-refresh" :disabled="balanceLoading" :aria-label="t('evmWallet.refresh')" @click="refreshBalances(true)"><AppIcon name="RefreshCw" :size="14" :class="{ 'auth-loading': balanceLoading }" /></button></div>
      <p v-if="balanceLoading" class="evm-balance-status" role="status">{{ t('evmWallet.balanceLoading') }}</p>
      <p v-else-if="balanceError" class="evm-balance-status" role="status">{{ t('evmWallet.balanceUnavailable') }}</p>
      <p v-if="loadError && !preview" class="evm-balance-status" role="alert">{{ t('evmWallet.loadFailed') }} <button class="evm-retry" @click="load">{{ t('evmWallet.retry') }}</button></p>
      <div v-if="wallet || preview" class="wallet-actions"><button @click="open('receive')"><AppIcon name="ArrowDownLeft" :size="17" />{{ t('evmWallet.receive') }}</button><button :aria-expanded="detailsOpen" @click="showDetails"><AppIcon name="Settings" :size="16" />{{ t('evmWallet.details') }}</button></div>
      <div v-else-if="!fetching && !loadError" class="wallet-actions"><button @click="open('create')">{{ t('evmWallet.create') }}</button></div>
    </div>
    <div v-if="detailsOpen && wallet && !preview" class="panel evm-wallet-details">
      <div class="section-card-header"><div><h2>{{ t('evmWallet.details') }}</h2><p>{{ t('evmWallet.keyInfo') }}</p></div><AppIcon name="ShieldCheck" :size="24" /></div>
      <details class="evm-public-key"><summary>{{ t('evmWallet.publicKey') }}</summary><code data-testid="evm-public-key">{{ wallet.publicKey }}</code><button class="text-action" @click="copy(wallet.publicKey)"><AppIcon name="Copy" :size="14" />{{ t('evmWallet.copyPublicKey') }}</button></details>
      <div class="evm-wallet-actions"><a class="button button-outline button-small" :href="wallet.explorerUrl" target="_blank" rel="noopener noreferrer">{{ t('evmWallet.explorer') }}<AppIcon name="ExternalLink" :size="15" /></a><button class="button button-outline button-small" @click="open('reveal')"><AppIcon name="LockKeyhole" :size="15" />{{ t('evmWallet.reveal') }}</button></div>
    </div>
    <ModalTransition><AppModal v-if="dialog" :title="dialog === 'receive' ? t('evmWallet.receive') : dialog === 'reveal' ? t('evmWallet.reveal') : t('evmWallet.create')" @close="close">
      <div v-if="dialog === 'receive' && wallet" class="wallet-action-modal evm-receive-dialog">
        <span class="modal-feature-icon"><AppIcon name="ArrowDownLeft" :size="26" /></span>
        <h2>{{ t('evmWallet.receive') }}</h2><p>{{ t('evmWallet.receiveHint', { network: wallet.network }) }}</p>
        <div class="evm-address-box"><span>{{ t('evmWallet.address') }}</span><code>{{ wallet.address }}</code></div>
        <button class="button button-orange" @click="copy(wallet.address)"><AppIcon name="Copy" :size="16" />{{ t('evmWallet.copyAddress') }}</button>
      </div>
      <div v-else class="wallet-action-modal evm-key-dialog"><span class="modal-feature-icon"><AppIcon name="LockKeyhole" :size="26" /></span><h2>{{ dialog === 'reveal' ? t('evmWallet.reveal') : t('evmWallet.create') }}</h2>
        <template v-if="privateKey"><p>{{ t('evmWallet.keyWarning') }}</p><label for="evm-private-key">{{ t('evmWallet.privateKey') }}</label><textarea id="evm-private-key" ref="privateKeyField" :value="privateKey" readonly rows="3" spellcheck="false" autocomplete="off" data-testid="evm-private-key" /><p class="evm-wallet-note">{{ t('evmWallet.autoHide') }}</p><div class="evm-wallet-actions"><button class="button button-outline button-small" @click="copy(privateKey)">{{ t('evmWallet.copyPrivateKey') }}</button><button class="button button-orange button-small" @click="close">{{ t('evmWallet.hide') }}</button></div></template>
        <form v-else class="account-form" @submit.prevent="submit"><p>{{ dialog === 'reveal' ? t('evmWallet.confirmReveal') : t('evmWallet.createHint') }}</p><label for="evm-wallet-password">{{ t('ui.confirm_with_your_password') }}</label><input id="evm-wallet-password" v-model="password" class="auth-input" type="password" autocomplete="current-password" required maxlength="128" :disabled="busy" /><p v-if="error" class="auth-error" role="alert">{{ tr(error) }}</p><button class="button button-orange auth-wallet-button" type="submit" :disabled="busy"><AppIcon v-if="busy" name="LoaderCircle" class="auth-loading" :size="17" />{{ busy ? t('ui.please_wait') : dialog === 'reveal' ? t('evmWallet.reveal') : t('evmWallet.create') }}</button></form>
      </div>
    </AppModal></ModalTransition>
  </section>
</template>

<style scoped>
.wallet-section, .wallet-section.wallet-compact { display: flex; flex-direction: column; gap: 20px; }
/* Clip the decorative ring without creating a focus-scrollable container. */
.evm-balance-card { min-height: 270px; overflow: clip; }
.balance-amount { overflow-wrap: anywhere; }
.evm-wallet-address { min-width: 0; align-items: flex-start; }
.evm-wallet-address code { min-width: 0; overflow-wrap: anywhere; font: inherit; line-height: 1.8; }
.evm-wallet-address button { flex-shrink: 0; margin-top: 2px; }
.evm-network-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: #b1b8c6; font-size: 11px; margin: 14px 0 0; }
.evm-testnet-badge { color: #f4e4b7; border: 1px solid #69634d; padding: 3px 7px; border-radius: 5px; font-size: 10px; }
.evm-refresh { margin-left: auto; color: #f4e4b7; padding: 5px; display: inline-flex; }
.evm-refresh:disabled { opacity: .5; }
.evm-balance-status, .evm-gas-balance { color: #b1b8c6; font-size: 11px; line-height: 1.7; margin-top: 10px; }
.evm-retry { text-decoration: underline; color: #f4e4b7; }
.evm-wallet-details { padding: 24px; min-width: 0; }
.evm-public-key { margin: 16px 0; font-size: 13px; }
.evm-public-key summary { cursor: pointer; font-weight: 700; }
.evm-public-key code { display: block; margin: 12px 0; overflow-wrap: anywhere; line-height: 1.8; font-size: 12px; }
.evm-wallet-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 18px; }
.evm-wallet-note { margin: 16px 0 0; font-size: 12px; line-height: 1.7; opacity: .65; }
.evm-key-dialog label { display: block; margin: 18px 0 8px; font-size: 13px; font-weight: 700; }
.evm-key-dialog textarea { width: 100%; box-sizing: border-box; resize: none; padding: 12px; border: 1px solid var(--border); border-radius: 10px; color: inherit; background: transparent; font: 13px/1.8 monospace; overflow-wrap: anywhere; }
.evm-address-box { text-align: left; border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin: 20px 0; }
.evm-address-box span { font-size: 12px; opacity: .65; }
.evm-address-box code { display: block; overflow-wrap: anywhere; margin-top: 8px; font: 13px/1.8 monospace; }
.evm-receive-dialog > .button { width: 100%; justify-content: center; }
@media (max-width: 480px) { .evm-wallet-details { padding: 18px; } .evm-wallet-actions .button { width: 100%; justify-content: center; } }
</style>
