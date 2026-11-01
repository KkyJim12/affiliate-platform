<script setup lang="ts">
import type { ReferralChainStatus } from "#shared/referral-contract";
import type { ExternalOperation } from "#shared/connected-wallet";
import { formatUsdt } from "#shared/plan";
const emit = defineEmits<{ updated: [] }>();
const { t } = useLoopI18n();
const { user } = useAccount();
const { matches, failureMessage } = useConnectedWallet();
const { submit, recover } = useWalletTransactions();
const { data, refresh } = await useFetch<{ chain: ReferralChainStatus; canManageFee: boolean; feeUpdate: { status: string; transactionHash: string } | null; totals: { volume: number; commissions: number; platform: number } }>("/api/admin/referrals/status", { key: `external-admin-chain-${user.value?.id}` });
const address = ref(""), error = ref(""), busy = ref(false), operation = ref<ExternalOperation | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
watch(() => data.value?.chain.feeRecipient,value => { if (value) address.value = value; }, { immediate: true });
watch(() => data.value?.feeUpdate?.status,(status,previous) => {
  if (status === "confirmed" || status === "failed") operation.value = null;
  if (status === "confirmed" && previous === "pending") emit("updated");
});
async function update() {
  busy.value = true; error.value = "";
  try {
    operation.value = await $fetch<ExternalOperation>("/api/admin/referrals/prepare-fee", { method: "POST",body: { address: address.value,requestKey: crypto.randomUUID() } });
    await submit(operation.value.id,"operation",operation.value.call); await recover(); await refresh();
    if (data.value?.feeUpdate?.status === "confirmed") emit("updated");
  } catch (failure) { error.value = failureMessage(failure); }
  finally { busy.value = false; }
}
onMounted(() => { timer = setInterval(() => { if (data.value?.feeUpdate?.status === "pending" || operation.value) void recover().then(() => refresh()); },5000); });
onBeforeUnmount(() => clearInterval(timer));
</script>
<template>
  <section class="admin-panel admin-contract-panel"><div class="admin-panel-heading"><div><h2>{{ t('onchain.adminTitle') }}</h2><p>{{ t('connected.confirmInWallet') }}</p></div><button class="admin-text-button" @click="refresh()">{{ t('admin.refresh') }}</button></div><div class="admin-contract-content">
    <WalletConnector v-if="!matches && user?.memberId !== '1'" @connected="refresh" />
    <template v-if="data?.chain.configured"><dl class="admin-details"><div><dt>{{ t('onchain.totalDistributed') }}</dt><dd>{{ formatUsdt(data.totals.volume) }}</dd></div><div><dt>{{ t('onchain.uplinePaid') }}</dt><dd>{{ formatUsdt(data.totals.commissions) }}</dd></div><div><dt>{{ t('onchain.platformPaid') }}</dt><dd>{{ formatUsdt(data.totals.platform) }}</dd></div></dl>
      <p>{{ t('onchain.owner') }}</p><code class="connected-address">{{ data.chain.owner }}</code><p>{{ t('onchain.currentFee') }}</p><code class="connected-address" data-testid="chain-fee-address">{{ data.chain.feeRecipient }}</code>
      <form v-if="data.canManageFee" class="account-form" @submit.prevent="update"><label for="external-fee-recipient">{{ t('onchain.newFeeAddress') }}</label><input id="external-fee-recipient" v-model="address" class="auth-input" maxlength="42" required :disabled="busy" /><button class="button button-orange" :disabled="busy || !matches || data.feeUpdate?.status === 'pending'">{{ t('connected.signFeeUpdate') }}</button></form><p v-else>{{ t('onchain.ownerRequired') }}</p>
      <p v-if="data.feeUpdate">{{ t(`connected.${data.feeUpdate.status}`) }}</p>
    </template><p v-else>{{ data?.chain.error || t('onchain.notConfigured') }}</p><p v-if="error" class="auth-error" role="alert">{{ error }}</p>
  </div></section>
</template>
