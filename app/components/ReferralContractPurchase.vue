<script setup lang="ts">
import type { ReferralProgram } from "#shared/referral";
import type { ChainPurchaseStatus, ReferralChainStatus } from "#shared/referral-contract";
import { formatUsdt } from "#shared/plan";

const props = defineProps<{ program: ReferralProgram | null; chain: ReferralChainStatus | null }>();
const emit = defineEmits<{ updated: []; refreshed: [status: ReferralChainStatus] }>();
const { t, tr } = useLoopI18n();
const { user } = useAccount();
const { notify } = useAppUI();
const { data: history } = await useFetch<ChainPurchaseStatus[]>("/api/referrals/chain/purchases", { key: `chain-purchases-${user.value?.id}` });
const current = ref<ChainPurchaseStatus | null>(props.chain?.pending ?? history.value?.[0] ?? null);
const confirmOpen = ref(false), busy = ref(false), refreshing = ref(false);
const password = ref(""), requestKey = ref(""), maxGasFee = ref("");
const error = ref("");
const symbol = computed(() => props.chain?.tokenSymbol || "USDT");
const price = computed(() => props.program?.nextPrice ?? 10);
const pending = computed(() => props.chain?.pending || (current.value?.status === "pending" ? current.value : null));
const canAfford = computed(() => props.chain?.balance !== null && Number(props.chain?.balance) >= price.value);
const hasGas = computed(() => !!props.chain?.gasBudget && Number(props.chain.gasBalance) >= Number(props.chain.gasBudget));
let timer: ReturnType<typeof setInterval> | undefined;
let mounted = false;
const observed = new Set<string>();

async function refreshState() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    const [state, purchases] = await Promise.all([$fetch<ReferralChainStatus>("/api/referrals/chain/status"), $fetch<ChainPurchaseStatus[]>("/api/referrals/chain/purchases")]);
    emit("refreshed", state);
    history.value = purchases;
    const previous = current.value;
    current.value = purchases.find(row => row.id === previous?.id) ?? state.pending ?? purchases[0] ?? null;
    if (previous?.status === "pending" && current.value?.status === "confirmed" && !observed.has(current.value.id)) {
      observed.add(current.value.id);
      emit("updated"); notify(t("onchain.confirmedNotice"));
    }
  } catch { error.value = t("onchain.refreshFailed"); }
  finally { refreshing.value = false; }
}
function openConfirmation() {
  if (!props.program?.nextLevel || !props.chain?.ready || pending.value) return;
  error.value = ""; password.value = ""; requestKey.value = crypto.randomUUID();
  maxGasFee.value = props.chain.gasBudget || ""; confirmOpen.value = true;
}
function closeConfirmation() { if (!busy.value) { confirmOpen.value = false; password.value = ""; } }
async function purchase() {
  if (busy.value || !props.program?.nextLevel) return;
  busy.value = true; error.value = "";
  try {
    current.value = await $fetch<ChainPurchaseStatus>("/api/referrals/chain/purchase", { method: "POST", body: {
      level: props.program.nextLevel, password: password.value, requestKey: requestKey.value, maxGasFee: maxGasFee.value,
    } });
    confirmOpen.value = false; password.value = "";
    if (current.value.status === "confirmed") { observed.add(current.value.id); emit("updated"); notify(t("onchain.confirmedNotice")); }
    await refreshState();
  } catch (failure) {
    error.value = (failure as { data?: { statusMessage?: string } }).data?.statusMessage || t("onchain.purchaseFailed");
    await refreshState();
  } finally { busy.value = false; }
}
onMounted(() => {
  mounted = true;
  // A status read can finalize a receipt after the parent's initial program read.
  if (current.value?.status === "confirmed" && current.value.level > (props.program?.currentLevel || 0)) emit("updated");
  timer = setInterval(() => { if (mounted && (pending.value || current.value?.status === "pending") && !busy.value) void refreshState(); }, 4000);
});
onBeforeUnmount(() => { mounted = false; password.value = ""; if (timer) clearInterval(timer); });
</script>

<template>
  <div class="referral-contract-purchase">
    <strong class="referral-paid-level" data-testid="referral-level">{{ t('referral.currentLevel', { level: program?.currentLevel || 0, max: 15 }) }}</strong>
    <p class="referral-contract-note">{{ t('onchain.networkHint') }}</p>
    <template v-if="chain?.configured">
      <div class="referral-balance"><span>{{ t('onchain.tokenBalance') }}</span><strong data-testid="chain-token-balance">{{ formatUsdt(Number(chain.balance || 0)) }} {{ symbol }}</strong></div>
      <div class="referral-balance"><span>{{ t('onchain.gasBalance') }}</span><strong>{{ formatUsdt(Number(chain.gasBalance || 0)) }} POL</strong></div>
      <a :href="`https://amoy.polygonscan.com/address/${chain.contractAddress}`" target="_blank" rel="noopener noreferrer" class="inline-link">{{ t('onchain.viewContract') }}<AppIcon name="ArrowUpRight" :size="14" /></a>
      <template v-if="program?.nextLevel">
        <p class="referral-contract-note">{{ t('referral.nextLevel', { level: program.nextLevel, amount: formatUsdt(price) }) }}</p>
        <button class="button button-orange referral-unlock-button" :disabled="busy || !!pending || !chain.ready || !canAfford || !hasGas" @click="openConfirmation">{{ t('onchain.buy', { level: program.nextLevel, amount: formatUsdt(price), symbol }) }}</button>
        <p v-if="!canAfford || !hasGas" class="referral-funding-hint">{{ t('onchain.fundingHint') }} <NuxtLink to="/dashboard?view=wallet">{{ t('ui.open_wallet') }}</NuxtLink></p>
        <p v-if="!chain.ready" class="referral-funding-hint">{{ t('onchain.pausedOrUnavailable') }}</p>
      </template>
      <p v-else class="referral-contract-note">{{ t('referral.maximumLevel') }}</p>
    </template>
    <p v-else class="referral-contract-note" role="status">{{ t('onchain.notConfigured') }}</p>
    <div v-if="current" class="referral-chain-result" :class="current.status" data-testid="chain-purchase-status" aria-live="polite">
      <strong>{{ t(`onchain.${current.status}`) }}</strong>
      <p v-if="current.status === 'pending'">{{ t('onchain.pendingHint') }}</p>
      <p v-if="current.status === 'failed'">{{ t('onchain.revertedHint') }}</p>
      <a v-if="current.explorerUrl" :href="current.explorerUrl" target="_blank" rel="noopener noreferrer">{{ t('onchain.viewTransaction') }}<AppIcon name="ArrowUpRight" :size="14" /></a>
    </div>
    <p v-if="error && !confirmOpen" class="auth-error" role="alert">{{ tr(error) }}</p>
    <button class="text-action" :disabled="refreshing || busy" @click="refreshState"><AppIcon name="RefreshCw" :size="14" />{{ t('onchain.refresh') }}</button>
    <ModalTransition><AppModal v-if="confirmOpen" :title="t('onchain.confirmTitle')" @close="closeConfirmation">
      <div class="admin-dialog referral-purchase-dialog"><h2>{{ t('onchain.confirmTitle') }}</h2><p>{{ t('onchain.confirmHint') }}</p>
        <dl class="admin-details"><div><dt>{{ t('referral.levelPrice') }}</dt><dd>{{ formatUsdt(price) }} {{ symbol }}</dd></div><div><dt>{{ t('onchain.maxGas') }}</dt><dd>{{ maxGasFee }} POL</dd></div><div><dt>{{ t('onchain.network') }}</dt><dd>Polygon Amoy · 80002</dd></div></dl>
        <p class="referral-contract-note">{{ t('onchain.approvalNotice') }}</p>
        <form class="account-form" @submit.prevent="purchase"><label for="chain-purchase-password">{{ t('ui.confirm_with_your_password') }}</label><input id="chain-purchase-password" v-model="password" class="auth-input" type="password" autocomplete="current-password" maxlength="128" required :disabled="busy" />
          <p v-if="error" class="auth-error" role="alert">{{ tr(error) }}</p>
          <button class="button button-orange" :disabled="busy" type="submit"><AppIcon v-if="busy" name="LoaderCircle" :size="16" class="auth-loading" />{{ busy ? t('ui.please_wait') : t('onchain.confirmPay', { amount: formatUsdt(price), symbol }) }}</button>
        </form>
      </div>
    </AppModal></ModalTransition>
  </div>
</template>
