<script setup lang="ts">
const network = usePolygonNetwork();
import { remainingLevelPrice } from "#shared/compensation";
import type { ReferralProgram } from "#shared/referral";
import type { ChainPurchaseStatus, ReferralChainStatus } from "#shared/referral-contract";
import type { ExternalPurchase } from "#shared/connected-wallet";
import { formatUsdt } from "#shared/plan";
const automaticApproval = ref(true);
const props = defineProps<{ program: ReferralProgram | null; chain: ReferralChainStatus | null }>();
const emit = defineEmits<{ updated: []; refreshed: [status: ReferralChainStatus] }>();
const { t } = useLoopI18n();
const { refreshWallet } = useEvmWallet();
const { matches, assertConnected, send, failureMessage } = useConnectedWallet();
const { submit, recover } = useWalletTransactions();
const current = ref<ChainPurchaseStatus | null>(props.chain?.pending ?? null), busy = ref(false), error = ref(""), confirmOpen = ref(false);
const stage = ref(""), requestKey = ref("");
const pending = computed(() => props.chain?.pending ?? (current.value?.status === "pending" || current.value?.status === "awaiting_signature" ? current.value : null));
const canAfford = computed(() => props.chain?.balance !== null && Number(props.chain?.balance) >= (props.program?.nextPrice ?? 10));
const canPurchase = computed(() => props.program?.purchaseAccess?.allowed === true);
let timer: ReturnType<typeof setInterval> | undefined;
let refreshing = false;
watch(() => props.program?.currentLevel, () => { requestKey.value = ""; });
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    await recover();
    const state = await $fetch<ReferralChainStatus>("/api/referrals/chain/status"); emit("refreshed",state);
    const history = await $fetch<ChainPurchaseStatus[]>("/api/referrals/chain/purchases");
    const latest = state.pending ?? history[0] ?? null;
    if (latest?.status === "confirmed" && (latest.level > (props.program?.currentLevel ?? 0)
      || latest.kind === 'rebirth' && (current.value?.id !== latest.id || current.value?.status !== 'confirmed'))) emit("updated");
    current.value = latest;
  } catch (failure) { error.value = failureMessage(failure); }
  finally { refreshing = false; }
}
async function purchase() {
  if (busy.value || !props.program?.nextLevel || !canPurchase.value) return;
  busy.value = true; error.value = "";
  try {
    await refreshWallet(); await assertConnected();
    requestKey.value ||= crypto.randomUUID();
    const prepared = await $fetch<ExternalPurchase>("/api/referrals/chain/prepare", { method: "POST",body: { level: props.program.nextLevel,requestKey: requestKey.value, automaticApproval: automaticApproval.value } });
    current.value = prepared.status;
    for (const call of prepared.calls) {
      stage.value = call.stage === "purchase" ? t('connected.signPurchase') : t('connected.signApproval');
      if (call.stage === "purchase") await submit(prepared.id,"purchase",call);
      else { const tx = await send(call); await tx.wait(); }
    }
    confirmOpen.value = false; requestKey.value = ""; await refresh();
  } catch (failure) { error.value = failureMessage(failure); await refresh(); }
  finally { busy.value = false; stage.value = ""; }
}
onMounted(() => { void refresh(); timer = setInterval(() => { if (!busy.value && (pending.value || props.program?.autoUpgrade)) void refresh(); },4000); });
onBeforeUnmount(() => clearInterval(timer));
</script>
<template>
  <div class="referral-contract-purchase">
    <strong class="referral-paid-level" data-testid="referral-level">{{ t('referral.currentLevel', { level: program?.currentLevel || 0,max: 15 }) }}</strong><p>{{ t('connected.purchaseHint') }}</p>
    <p v-if="program?.purchaseAccess?.requiresSponsor" class="referral-funding-hint" data-testid="referral-required" role="status">{{ t('referral.sponsorRequired') }}</p>
    <WalletConnector v-if="!matches" @connected="refresh" />
    <template v-if="chain?.configured">
      <div class="referral-balance"><span>{{ t('onchain.tokenBalance') }}</span><strong data-testid="chain-token-balance">{{ formatUsdt(Number(chain.balance || 0)) }} {{ chain.tokenSymbol }}</strong></div>
      <button v-if="program?.nextLevel" class="button button-orange referral-unlock-button" :disabled="busy || !canPurchase || !matches || !chain.ready || !canAfford || pending?.status === 'pending'" @click="error = ''; confirmOpen = true">{{ pending?.status === 'awaiting_signature' ? t('connected.resumePurchase') : t('onchain.buy', { level: program.nextLevel,amount: formatUsdt(program.nextPrice || 10),symbol: chain.tokenSymbol }) }}</button>
      <p v-if="!canAfford && chain.balance !== null" class="referral-funding-hint" role="status">{{ t('onchain.tokenRequired', { required: formatUsdt(program?.nextPrice || 10),available: formatUsdt(Number(chain.balance)),symbol: chain.tokenSymbol }) }}</p>
      <p v-if="!chain.ready">{{ t('onchain.pausedOrUnavailable') }}</p>
    </template>
    <p v-if="program?.autoUpgrade" role="status">{{ t(program.autoUpgrade.kind === 'rebirth' ? 'matrix.rebirthQueued' : 'matrix.upgradeQueued', { level: program.autoUpgrade.level }) }} {{ program.autoUpgrade.lastError ? t('matrix.upgradeWaiting') : '' }}</p>
    <p v-if="!chain?.configured" role="status">{{ chain?.error || t('onchain.notConfigured') }}</p>
    <div v-if="current" class="referral-chain-result" :class="current.status" data-testid="chain-purchase-status" aria-live="polite"><strong>{{ t(`connected.${current.status}`) }}</strong><p v-if="current.status === 'pending'">{{ t('onchain.pendingHint') }}</p><a v-if="current.explorerUrl" :href="current.explorerUrl" target="_blank" rel="noopener noreferrer">{{ t('onchain.viewTransaction') }}</a></div>
    <p v-if="error && !confirmOpen" class="auth-error" role="alert">{{ error }}</p><button class="text-action" :disabled="busy" @click="refresh">{{ t('onchain.refresh') }}</button>
    <ModalTransition><AppModal v-if="confirmOpen" :title="t('onchain.confirmTitle')" @close="!busy && (confirmOpen = false)"><div class="admin-dialog referral-purchase-dialog"><h2>{{ t('onchain.confirmTitle') }}</h2><p>{{ t('connected.confirmInWallet') }}</p>
      <dl class="admin-details"><div><dt>{{ t('referral.levelPrice') }}</dt><dd>{{ formatUsdt(program?.nextPrice || 10) }} {{ chain?.tokenSymbol }}</dd></div><div><dt>{{ t('onchain.network') }}</dt><dd>{{ network.name }} · {{ network.chainId }}</dd></div></dl>
      <label class="admin-checkbox"><input v-model="automaticApproval" type="checkbox" :disabled="busy" /><span>{{ t('matrix.autoApproval', { amount: formatUsdt(remainingLevelPrice(program?.nextLevel || 1)), symbol: chain?.tokenSymbol || 'USDT' }) }}</span></label><p>{{ t('matrix.approvalHint') }}</p><p v-if="stage" role="status">{{ stage }}</p><p v-if="error" class="auth-error" role="alert">{{ error }}</p>
      <button class="button button-orange" :disabled="busy || !canPurchase || !matches" @click="purchase">{{ busy ? t('connected.checkWallet') : t('connected.signPurchase') }}</button>
    </div></AppModal></ModalTransition>
  </div>
</template>
