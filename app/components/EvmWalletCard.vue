<script setup lang="ts">
import type { EvmWalletDetails } from "#shared/evm-wallet";

const { t, tr } = useLoopI18n();
const { user } = useAccount();
const { copy } = useAppUI();
const wallet = ref<EvmWalletDetails | null>(null);
const fetching = ref(true);
const loadError = ref(false);
const dialog = ref<"create" | "reveal" | null>(null);
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
function open(action: "create" | "reveal") {
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
    if (version === loadVersion && user.value?.id === accountId) wallet.value = result.wallet;
  } catch {
    if (version === loadVersion) loadError.value = true;
  } finally {
    if (version === loadVersion) fetching.value = false;
  }
}
async function submit() {
  if (busy.value || !dialog.value || !user.value) return;
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
watch(() => user.value?.id, () => { close(); void load(); }, { flush: "sync" });
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
  <section class="panel evm-wallet-card" data-testid="evm-wallet" :aria-label="t('evmWallet.title')">
    <div class="section-card-header">
      <div><span class="evm-testnet-badge"><AppIcon name="Globe" :size="13" />{{ t('evmWallet.testnet') }}</span><h2>{{ t('evmWallet.title') }}</h2><p>{{ t('evmWallet.subtitle') }}</p></div>
      <AppIcon name="ShieldCheck" :size="24" />
    </div>
    <p v-if="fetching" role="status">{{ t('evmWallet.loading') }}</p>
    <div v-else-if="loadError"><p class="form-error" role="alert">{{ t('evmWallet.loadFailed') }}</p><button class="button button-outline button-small" @click="load">{{ t('evmWallet.retry') }}</button></div>
    <template v-else-if="wallet">
      <dl class="evm-network-details"><div><dt>{{ t('evmWallet.network') }}</dt><dd>{{ wallet.network }}</dd></div><div><dt>{{ t('evmWallet.chainId') }}</dt><dd>{{ wallet.chainId }}</dd></div><div><dt>{{ t('evmWallet.gasToken') }}</dt><dd>{{ t('evmWallet.testPol') }}</dd></div></dl>
      <div class="evm-address-box"><span>{{ t('evmWallet.address') }}</span><div><code data-testid="evm-address">{{ wallet.address }}</code><button class="icon-button" :aria-label="t('evmWallet.copyAddress')" @click="copy(wallet.address)"><AppIcon name="Copy" :size="17" /></button></div></div>
      <details class="evm-public-key"><summary>{{ t('evmWallet.publicKey') }}</summary><code data-testid="evm-public-key">{{ wallet.publicKey }}</code><button class="text-action" @click="copy(wallet.publicKey)"><AppIcon name="Copy" :size="14" />{{ t('evmWallet.copyPublicKey') }}</button></details>
      <div class="evm-wallet-actions"><a class="button button-outline button-small" :href="wallet.explorerUrl" target="_blank" rel="noopener noreferrer">{{ t('evmWallet.explorer') }}<AppIcon name="ExternalLink" :size="15" /></a><button class="button button-outline button-small" @click="open('reveal')"><AppIcon name="LockKeyhole" :size="15" />{{ t('evmWallet.reveal') }}</button></div>
      <p class="evm-wallet-note">{{ t('evmWallet.balanceNote') }}</p>
    </template>
    <div v-else><p class="evm-wallet-note">{{ t('evmWallet.createHint') }}</p><button class="button button-outline button-small" @click="open('create')">{{ t('evmWallet.create') }}</button></div>
    <ModalTransition><AppModal v-if="dialog" :title="dialog === 'reveal' ? t('evmWallet.reveal') : t('evmWallet.create')" @close="close">
      <div class="wallet-action-modal evm-key-dialog"><span class="modal-feature-icon"><AppIcon name="LockKeyhole" :size="26" /></span><h2>{{ dialog === 'reveal' ? t('evmWallet.reveal') : t('evmWallet.create') }}</h2>
        <template v-if="privateKey"><p>{{ t('evmWallet.keyWarning') }}</p><label for="evm-private-key">{{ t('evmWallet.privateKey') }}</label><textarea id="evm-private-key" ref="privateKeyField" :value="privateKey" readonly rows="3" spellcheck="false" autocomplete="off" data-testid="evm-private-key" /><p class="evm-wallet-note">{{ t('evmWallet.autoHide') }}</p><div class="evm-wallet-actions"><button class="button button-outline button-small" @click="copy(privateKey)">{{ t('evmWallet.copyPrivateKey') }}</button><button class="button button-orange button-small" @click="close">{{ t('evmWallet.hide') }}</button></div></template>
        <form v-else class="account-form" @submit.prevent="submit"><p>{{ dialog === 'reveal' ? t('evmWallet.confirmReveal') : t('evmWallet.createHint') }}</p><label for="evm-wallet-password">{{ t('ui.confirm_with_your_password') }}</label><input id="evm-wallet-password" v-model="password" class="auth-input" type="password" autocomplete="current-password" required maxlength="128" :disabled="busy" /><p v-if="error" class="auth-error" role="alert">{{ tr(error) }}</p><button class="button button-orange auth-wallet-button" type="submit" :disabled="busy"><AppIcon v-if="busy" name="LoaderCircle" class="auth-loading" :size="17" />{{ busy ? t('ui.please_wait') : dialog === 'reveal' ? t('evmWallet.reveal') : t('evmWallet.create') }}</button></form>
      </div>
    </AppModal></ModalTransition>
  </section>
</template>

<style scoped>
.evm-wallet-card { padding: 24px; min-width: 0; }
.evm-testnet-badge { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 8px; color: var(--orange, #c28b28); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.evm-network-details { display: flex; flex-wrap: wrap; gap: 16px 32px; margin: 20px 0; }
.evm-network-details dt, .evm-address-box > span { font-size: 12px; opacity: .65; }
.evm-network-details dd { margin: 5px 0 0; font-weight: 700; font-size: 14px; }
.evm-address-box { border: 1px solid var(--border); border-radius: 12px; padding: 14px; }
.evm-address-box > div { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.evm-address-box code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; line-height: 1.7; }
.evm-address-box button { flex-shrink: 0; }
.evm-public-key { margin: 16px 0; font-size: 13px; }
.evm-public-key summary { cursor: pointer; font-weight: 700; }
.evm-public-key code { display: block; margin: 12px 0; overflow-wrap: anywhere; line-height: 1.8; font-size: 12px; }
.evm-wallet-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 18px; }
.evm-wallet-note { margin: 16px 0 0; font-size: 12px; line-height: 1.7; opacity: .65; }
.evm-key-dialog label { display: block; margin: 18px 0 8px; font-size: 13px; font-weight: 700; }
.evm-key-dialog textarea { width: 100%; box-sizing: border-box; resize: none; padding: 12px; border: 1px solid var(--border); border-radius: 10px; color: inherit; background: transparent; font: 13px/1.8 monospace; overflow-wrap: anywhere; }
@media (max-width: 480px) { .evm-wallet-card { padding: 18px; } .evm-wallet-actions .button { width: 100%; justify-content: center; } }
</style>
