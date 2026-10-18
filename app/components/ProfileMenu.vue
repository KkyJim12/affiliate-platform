<script setup lang="ts">
import type { EvmWalletDetails } from "#shared/evm-wallet";

const props = withDefaults(defineProps<{ settingsTo?: string; logoutTo?: string }>(), {
  settingsTo: "/dashboard?view=settings", logoutTo: "/",
});
const { user, logout } = useAccount();
const { t, locale, localeTag } = useLoopI18n();
const { balances, balanceLoading, refreshBalances } = useEvmWallet();
const { copy, notify } = useAppUI();
const route = useRoute();
const uid = useId();
const triggerId = `profile-trigger-${uid}`;
const menuId = `profile-menu-${uid}`;
const balanceId = `profile-balance-${uid}`;
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const open = ref(false);
const wallet = ref<EvmWalletDetails | null>(null);
const loading = ref(false);
const failed = ref(false);
const signingOut = ref(false);
const menuStyle = ref<Record<string, string>>({ visibility: "hidden" });
let requestVersion = 0;
let mounted = false;
const usdtAmount = computed(() => balances.value?.token?.symbol.toUpperCase() === "USDT" ? balances.value.token.balance : null);
const formattedBalance = computed(() => {
  if (usdtAmount.value === null) return "—";
  const [whole = "0", fraction = ""] = usdtAmount.value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2)) + (Number(fraction[2] || "0") >= 5 ? 1n : 0n);
  const format = new Intl.NumberFormat(localeTag.value);
  const decimal = format.formatToParts(1.1).find(part => part.type === "decimal")?.value ?? ".";
  return format.format(cents / 100n) + decimal + String(cents % 100n).padStart(2, "0");
});
const balanceTitle = computed(() => balanceLoading.value ? t("profileMenu.loadingBalance")
  : usdtAmount.value === null ? t("profileMenu.balanceUnavailable") : `${usdtAmount.value} USDT`);

function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function position() {
  if (!open.value || !trigger.value || !menu.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  if (anchor.bottom < 0 || anchor.top > height) { close(); return; }
  const below = height - anchor.bottom - 20;
  const above = anchor.top - 20;
  const flip = below < Math.min(menu.value.scrollHeight, 280) && above > below;
  const maxHeight = Math.max(48, flip ? above : below);
  const menuWidth = Math.min(320, width - 24);
  menuStyle.value = { visibility: "visible", width: `${menuWidth}px`,
    left: `${Math.max(12, Math.min(anchor.right - menuWidth, width - menuWidth - 12))}px`,
    top: `${Math.max(12, flip ? anchor.top - Math.min(menu.value.scrollHeight, maxHeight) - 8 : anchor.bottom + 8)}px`,
    maxHeight: `${maxHeight}px` };
}
function items() {
  return Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
}
async function loadWallet() {
  const version = ++requestVersion;
  const accountId = user.value?.id;
  wallet.value = null;
  loading.value = true;
  failed.value = false;
  try {
    if (!accountId) return;
    const result = await $fetch<{ wallet: EvmWalletDetails | null }>("/api/wallet/evm");
    if (version === requestVersion && user.value?.id === accountId) wallet.value = result.wallet;
  } catch {
    if (version === requestVersion) failed.value = true;
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}
async function show(last = false) {
  if (!user.value) return;
  menuStyle.value = { visibility: "hidden" };
  open.value = true;
  void loadWallet();
  void refreshBalances();
  await nextTick();
  position();
  await nextTick();
  if (!open.value) return;
  const actions = items();
  (last ? actions.at(-1) : actions[0])?.focus({ preventScroll: true });
}
function onMenuKeydown(event: KeyboardEvent) {
  if (event.key === "Tab") { close(true); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const actions = items();
  if (!actions.length) return;
  const current = actions.indexOf(document.activeElement as HTMLElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? actions.length - 1
    : (current + (event.key === "ArrowDown" ? 1 : -1) + actions.length) % actions.length;
  actions[index]?.focus({ preventScroll: true });
}
function outside(event: Event) {
  const target = event.target as Node | null;
  if (open.value && target && !trigger.value?.contains(target) && !menu.value?.contains(target)) close();
}
function onEscape(event: KeyboardEvent) {
  if (open.value && event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  }
}
function onScroll(event: Event) { if (!menu.value?.contains(event.target as Node)) position(); }
async function signOut() {
  if (signingOut.value) return;
  signingOut.value = true;
  try {
    await logout();
    close();
    await navigateTo(props.logoutTo);
  } catch {
    notify("We could not sign you out. Please try again.");
  } finally { signingOut.value = false; }
}
function retire(element: Element) {
  element.setAttribute("aria-hidden", "true");
  (element as HTMLElement).inert = true;
}
watch(() => user.value?.id, () => { requestVersion++; wallet.value = null; close(); if (mounted) void refreshBalances(); }, { flush: "sync" });
watch(() => route.fullPath, () => { close(); void refreshBalances(); });
watch([loading, failed, wallet, locale, balances], () => { if (open.value) nextTick(position); });
onMounted(() => {
  mounted = true;
  void refreshBalances();
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", outside);
  document.addEventListener("keydown", onEscape);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", position);
});
onBeforeUnmount(() => {
  mounted = false;
  requestVersion++;
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", outside);
  document.removeEventListener("keydown", onEscape);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", position);
});
</script>

<template>
  <div v-if="user" class="profile-menu">
    <button :id="triggerId" ref="trigger" type="button" class="profile-menu-trigger" :class="{ active: open }"
      :aria-label="t('profileMenu.open', { username: user.username })" :aria-describedby="balanceId" aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? menuId : undefined"
      @click="open ? close() : show()" @keydown.down.prevent="show()" @keydown.up.prevent="show(true)">
      <span :id="balanceId" class="profile-menu-balance" :title="balanceTitle" :aria-busy="balanceLoading" data-testid="profile-usdt-balance"><strong>{{ formattedBalance }}</strong> <small>USDT</small></span>
      <span class="profile-menu-avatar" aria-hidden="true">{{ user.username.slice(0, 2).toUpperCase() }}</span><AppIcon class="profile-menu-chevron" name="ChevronDown" :size="12" />
    </button>
    <Teleport to="body"><Transition name="dropdown" @before-leave="retire">
      <div v-if="open" :id="menuId" ref="menu" class="profile-menu-panel" role="menu" :aria-labelledby="triggerId" :style="menuStyle" @keydown="onMenuKeydown">
        <div class="profile-menu-heading" role="presentation"><strong>@{{ user.username }}</strong><span>{{ t('profileMenu.account') }}</span></div>
        <div class="profile-menu-wallet" role="presentation">
          <div class="profile-menu-balance-row" :title="balanceTitle"><span>{{ t('profileMenu.usdtBalance') }}</span><strong>{{ formattedBalance }} USDT</strong></div>
          <span class="profile-menu-label">{{ t('evmWallet.address') }}</span>
          <p v-if="loading" role="status">{{ t('evmWallet.loading') }}</p>
          <template v-else-if="failed"><p>{{ t('evmWallet.loadFailed') }}</p><button class="profile-menu-retry" role="menuitem" @click="loadWallet">{{ t('evmWallet.retry') }}</button></template>
          <template v-else-if="wallet"><span class="profile-menu-network">{{ wallet.network }}</span><button role="menuitem" class="profile-menu-address" :aria-label="t('evmWallet.copyAddress')" @click="copy(wallet.address)"><code data-testid="profile-wallet-address">{{ wallet.address }}</code><AppIcon name="Copy" :size="16" /></button></template>
          <p v-else>{{ t('profileMenu.noWallet') }}</p>
        </div>
        <div class="profile-menu-actions" role="presentation">
          <NuxtLink role="menuitem" class="profile-menu-action" to="/dashboard?view=wallet" @click="close()"><AppIcon name="Wallet" :size="17" />{{ t('profileMenu.wallet') }}</NuxtLink>
          <NuxtLink role="menuitem" class="profile-menu-action" :to="settingsTo" @click="close()"><AppIcon name="Settings" :size="17" />{{ t('ui.account_settings') }}</NuxtLink>
          <button role="menuitem" class="profile-menu-action profile-menu-logout" :disabled="signingOut" @click="signOut"><AppIcon :name="signingOut ? 'LoaderCircle' : 'LogOut'" :size="17" :class="{ 'auth-loading': signingOut }" />{{ signingOut ? t('ui.please_wait') : t('ui.sign_out') }}</button>
        </div>
      </div>
    </Transition></Teleport>
  </div>
</template>

<style scoped>
.profile-menu { display: inline-flex; flex-shrink: 0; }
.profile-menu-trigger { display: inline-flex; align-items: center; gap: 9px; padding: 4px 8px 4px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text-secondary); cursor: pointer; }
.profile-menu-trigger:hover, .profile-menu-trigger.active { background: var(--gold-soft); color: var(--gold-text); }
.profile-menu-avatar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--gold-border); background: var(--gold-soft); color: var(--gold-text); font-size: 11px; font-weight: 750; }
.profile-menu-chevron { transition: transform .18s; }
.profile-menu-balance { display: flex; align-items: baseline; gap: 5px; min-width: 0; max-width: 160px; white-space: nowrap; }
.profile-menu-balance strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary); font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.profile-menu-balance small { color: var(--text-secondary); font-size: 10px; }
.profile-menu-balance-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--border); font-size: 11px; }
.profile-menu-balance-row > span { color: var(--text-secondary); }
.profile-menu-balance-row strong { min-width: 0; overflow-wrap: anywhere; text-align: right; color: var(--text-primary); font-size: 12px; font-variant-numeric: tabular-nums; }
.profile-menu-trigger.active .profile-menu-chevron { transform: rotate(180deg); }
.profile-menu-panel { position: fixed; z-index: 160; box-sizing: border-box; overflow-y: auto; padding: 6px; border: 1px solid var(--border); border-radius: 15px; background: var(--surface); color: var(--text-primary); box-shadow: 0 14px 45px #00000024; text-align: left; }
.profile-menu-heading { display: grid; gap: 4px; padding: 13px 12px; }
.profile-menu-heading strong { overflow-wrap: anywhere; font-size: 14px; }
.profile-menu-heading > span, .profile-menu-label { font-size: 11px; color: var(--text-secondary); }
.profile-menu-wallet { display: grid; gap: 8px; margin: 0 5px 8px; padding: 12px; border-radius: 10px; background: var(--surface-alt); border: 1px solid var(--border); }
.profile-menu-wallet p { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.profile-menu-network { color: var(--gold-text); font-size: 11px; font-weight: 650; }
.profile-menu-address { display: flex; align-items: center; gap: 12px; width: 100%; padding: 0; color: var(--text-primary); background: transparent; border: 0; cursor: pointer; text-align: left; }
.profile-menu-address code { min-width: 0; flex: 1; overflow-wrap: anywhere; font-size: 12px; line-height: 1.7; }
.profile-menu-address svg { flex-shrink: 0; color: var(--text-secondary); }
.profile-menu-address:hover { color: var(--gold-text); }
.profile-menu-actions { padding-top: 5px; border-top: 1px solid var(--border); }
.profile-menu-action { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 42px; padding: 10px 12px; border: 0; border-radius: 8px; background: transparent; color: var(--text-primary); font-size: 13px; text-align: left; cursor: pointer; }
.profile-menu-action:hover, .profile-menu-action:focus-visible { background: var(--gold-soft); }
.profile-menu-logout { color: var(--danger); }
.profile-menu-logout:disabled { opacity: .6; cursor: wait; }
.profile-menu-retry { justify-self: start; color: var(--gold-text); font-size: 12px; text-decoration: underline; }
@media (max-width: 760px) {
  .profile-menu-avatar { width: 30px; height: 30px; font-size: 10px; flex-shrink: 0; }
  .profile-menu-trigger { gap: 6px; padding: 4px 6px; }
  .profile-menu-chevron { width: 10px; flex-shrink: 0; }
  .profile-menu-balance { display: grid; gap: 0; max-width: 74px; text-align: right; line-height: 1.3; }
  .profile-menu-balance strong { font-size: 11px; }
  .profile-menu-balance small { font-size: 9px; }
}
@media (max-width: 360px) { .profile-menu-balance { max-width: 44px; } }
@media (prefers-reduced-motion: reduce) { .profile-menu-chevron { transition: none; } }
</style>
