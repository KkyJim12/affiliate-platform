<script setup lang="ts">
import type { ReferralChainStatus } from "#shared/referral-contract";
import { formatUsdt } from "#shared/plan";
const emit = defineEmits<{ updated: [] }>();
const { t, tr } = useLoopI18n();
const { notify } = useAppUI();
const { user } = useAccount();
interface AdminChainState {
  chain: ReferralChainStatus; canManageFee: boolean;
  feeUpdate: { status: string; transactionHash: string } | null;
  totals: { purchases: number; volume: number; commissions: number; platform: number };
}
const { data, error: loadError, refresh } = await useFetch<AdminChainState>("/api/admin/referrals/status", { key: `admin-referral-chain-${user.value?.id}` });
const address = ref(""), password = ref(""), requestKey = ref("");
const busy = ref(false), error = ref("");
let timer: ReturnType<typeof setInterval> | undefined;
watch(() => data.value?.chain.feeRecipient, value => { if (value) address.value = value; }, { immediate: true });
async function updateFee() {
  if (busy.value || !data.value?.chain.gasBudget) return;
  busy.value = true; error.value = "";
  requestKey.value ||= crypto.randomUUID();
  try {
    const result = await $fetch<{ status: string; transactionHash: string }>("/api/admin/referrals/fee", { method: "POST", body: {
      address: address.value.trim(), password: password.value, requestKey: requestKey.value, maxGasFee: data.value.chain.gasBudget,
    } });
    password.value = ""; requestKey.value = "";
    await refresh();
    if (result.status === "confirmed") { emit("updated"); notify(t("onchain.feeUpdated")); }
  } catch (failure) { error.value = (failure as { data?: { statusMessage?: string } }).data?.statusMessage || t("onchain.purchaseFailed"); }
  finally { busy.value = false; }
}
watch(() => data.value?.feeUpdate?.status, (value, previous) => { if (previous === "pending" && value === "confirmed") emit("updated"); });
onMounted(() => { timer = setInterval(() => { if (!busy.value && data.value?.feeUpdate?.status === "pending") void refresh(); }, 5000); });
onBeforeUnmount(() => { password.value = ""; if (timer) clearInterval(timer); });
</script>

<template>
  <section v-if="data?.chain.mode === 'contract' || loadError" class="admin-panel admin-contract-panel">
    <div class="admin-panel-heading"><div><h2>{{ t('onchain.adminTitle') }}</h2><p>{{ t('onchain.adminHint') }}</p></div><button class="admin-text-button" @click="refresh()">{{ t('admin.refresh') }}</button></div>
    <div class="admin-contract-content">
      <p v-if="loadError" class="auth-error" role="alert">{{ t('admin.loadError') }}</p>
      <template v-else-if="data">
        <template v-if="data.chain.configured">
          <dl class="admin-details"><div><dt>{{ t('onchain.network') }}</dt><dd>Polygon Amoy</dd></div><div><dt>{{ t('onchain.totalDistributed') }}</dt><dd>{{ formatUsdt(data.totals.volume) }} {{ data.chain.tokenSymbol }}</dd></div><div><dt>{{ t('onchain.uplinePaid') }}</dt><dd>{{ formatUsdt(data.totals.commissions) }} {{ data.chain.tokenSymbol }}</dd></div><div><dt>{{ t('onchain.platformPaid') }}</dt><dd>{{ formatUsdt(data.totals.platform) }} {{ data.chain.tokenSymbol }}</dd></div></dl>
          <p>{{ t('onchain.owner') }}</p><p class="admin-fee-address">{{ data.chain.owner }}</p>
          <p>{{ t('onchain.currentFee') }}</p><p class="admin-fee-address" data-testid="chain-fee-address">{{ data.chain.feeRecipient }}</p>
          <form v-if="data.canManageFee" class="account-form" @submit.prevent="updateFee">
            <label for="chain-fee-recipient">{{ t('onchain.newFeeAddress') }}</label><input id="chain-fee-recipient" v-model="address" class="auth-input" maxlength="42" required spellcheck="false" :disabled="busy" @input="requestKey = ''" />
            <label for="chain-fee-password">{{ t('ui.confirm_with_your_password') }}</label><input id="chain-fee-password" v-model="password" class="auth-input" type="password" autocomplete="current-password" maxlength="128" required :disabled="busy" />
            <p>{{ t('onchain.feeGasNotice', { amount: data.chain.gasBudget || '0' }) }}</p>
            <button class="button button-orange" type="submit" :disabled="busy || data.feeUpdate?.status === 'pending' || !data.chain.configured || address.toLowerCase() === data.chain.feeRecipient?.toLowerCase()">{{ busy ? t('ui.please_wait') : t('onchain.updateFee') }}</button>
          </form>
          <p v-else>{{ t('onchain.ownerRequired') }}</p>
          <p v-if="data.feeUpdate?.status === 'pending'" role="status">{{ t('onchain.feePending') }}</p>
          <a v-if="data.feeUpdate?.transactionHash" class="inline-link" :href="`https://amoy.polygonscan.com/tx/${data.feeUpdate.transactionHash}`" target="_blank" rel="noopener noreferrer">{{ t('onchain.viewTransaction') }}</a>
        </template>
        <p v-else>{{ t('onchain.notConfigured') }}</p>
        <p v-if="error" class="auth-error" role="alert">{{ tr(error) }}</p>
      </template>
    </div>
  </section>
</template>
