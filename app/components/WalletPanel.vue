<script setup lang="ts">
const { t, tr, localeTag, formatDate } = useLoopI18n();

import { formatUsdt } from "#shared/plan";
import type { WalletTransaction } from "../../shared/types";

const props = withDefaults(defineProps<{ preview?: boolean; compact?: boolean }>(), { preview: false, compact: false });
const { authOpen, notify, copy } = useAppUI();
const { wallet, walletError, refreshWallet, requestDeposit, transfer } = useWallet();
const action = ref<"deposit" | "transfer" | null>(null);
const amount = ref("");
const recipient = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);
const filter = ref("all");
const requestKey = ref("");
const sampleTransactions: WalletTransaction[] = [
  { id: "sample-1", type: "commission", amount: 100, status: "completed", description: "Matrix · layer 3 · rank 3", createdAt: "2026-10-17T09:30:00Z" },
  { id: "sample-2", type: "commission", amount: 12.8, status: "completed", description: "Unilevel · referral commissions", createdAt: "2026-10-16T12:00:00Z" },
  { id: "sample-3", type: "commission", amount: 32, status: "completed", description: "Matrix · layer 2 · rank 3", createdAt: "2026-10-15T12:00:00Z" },
  { id: "sample-4", type: "commission", amount: 8, status: "completed", description: "Matrix · layer 1 · rank 3", createdAt: "2026-10-14T12:00:00Z" },
];
const transactions = computed(() => (props.preview ? sampleTransactions : wallet.value?.transactions || []).filter((item) => filter.value === "all" || (filter.value === "pending" ? item.status === "pending" : item.status === "completed")));
const available = computed(() => props.preview ? 152.8 : wallet.value?.available || 0);
const pendingFunding = computed(() => props.preview ? 0 : (wallet.value?.transactions || []).filter((item) => item.type === "deposit" && item.status === "pending").reduce((sum, item) => sum + item.amount, 0));
const money = (value: number) => value.toLocaleString(localeTag.value, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
function openAction(value: "deposit" | "transfer") {
  if (props.preview) { authOpen.value = true; return; }
  action.value = value;
  amount.value = "";
  recipient.value = "";
  password.value = "";
  error.value = "";
  requestKey.value = crypto.randomUUID();
}
async function submit() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    if (action.value === "deposit") await requestDeposit(amount.value, requestKey.value);
    else await transfer(amount.value, recipient.value, password.value, requestKey.value);
    notify(action.value === "deposit" ? "Funding request saved. Your balance changes after settlement." : "Transfer completed.");
    action.value = null;
    password.value = "";
  } catch (err) {
    error.value = (err as { data?: { statusMessage?: string } }).data?.statusMessage || "The request could not be completed. Please try again.";
  } finally { loading.value = false; }
}
function exportCsv() {
  const lines = [tr("Date,Description,Type,Amount (USDT),Status"), ...transactions.value.map((item) => [item.createdAt, transactionDescription(item), t(`ui.transaction_${item.type}`), item.amount, t(`ui.${item.status}`)].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))];
  const url = URL.createObjectURL(new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a"); link.href = url; link.download = "loop-wallet-transactions.csv"; link.click(); URL.revokeObjectURL(url);
}
function transactionDescription(item: WalletTransaction) {
  if (props.preview) return tr(item.description);
  if (item.type === 'deposit') return tr('Funding request · {amount} USDT', { amount: money(item.amount) });
  const username = item.description.match(/@([a-z][a-z0-9_]*)$/)?.[1];
  if (username && item.type === 'transfer_out') return tr('Transfer to {username}', { username: '@' + username });
  if (username && item.type === 'transfer_in') return tr('Transfer from {username}', { username: '@' + username });
  return tr(item.description);
}
function closeAction() { action.value = null; password.value = ""; }
</script>

<template>
  <section class="wallet-section" :class="{ 'wallet-compact': compact }">
    <div class="balance-card">
      <div class="balance-top"><span><AppIcon name="Wallet" :size="18" />{{ t('ui.in_app_wallet') }}</span><span class="wallet-currency"><UsdtIcon />USDT</span></div>
      <p class="balance-label">{{ preview ? t('ui.illustrative_balance') : t('ui.available_balance') }}</p>
      <div class="balance-amount" data-testid="wallet-balance">{{ money(available) }}<span>USDT</span></div>
      <div class="wallet-id"><span>{{ preview ? t('ui.plan_preview_sample_activity') : wallet?.id || t('ui.loading_your_wallet') }}</span><button v-if="wallet && !preview" :aria-label="t('ui.copy_wallet_id')" @click="copy(wallet.id, 'Wallet ID copied')"><AppIcon name="Copy" :size="14" /></button></div>
      <div class="wallet-actions"><button @click="openAction('deposit')"><AppIcon name="Plus" :size="17" />{{ t('ui.request_funds') }}</button><button @click="openAction('transfer')"><AppIcon name="Send" :size="16" />{{ t('ui.transfer') }}</button></div>
    </div>
    <p v-if="walletError && !preview" class="form-error" role="alert">{{ tr(walletError) }}</p>
    <div v-if="!compact" class="wallet-details-row">
      <article class="panel wallet-detail"><span>{{ t('ui.pending_funding_requests') }}</span><strong>{{ money(pendingFunding) }} <small>USDT</small></strong><p>{{ t('ui.awaiting_verification_and_settlement') }}</p></article>
      <article class="panel wallet-detail"><span>{{ t('ui.total_commissions_credited') }}</span><strong>{{ formatUsdt(preview ? 152.8 : wallet?.earned || 0) }} <small>USDT</small></strong><p>{{ t('ui.completed_credits_to_your_wallet') }}</p></article>
    </div>
    <div class="panel wallet-history">
      <div class="section-card-header"><div><h2>{{ compact ? t('ui.latest_activity') : t('ui.transaction_history') }}</h2><p>{{ preview ? t('ui.an_example_of_your_wallet_activity') : t('ui.every_movement_all_in_one_place') }}</p></div><NuxtLink v-if="compact" to="/dashboard?view=wallet" class="inline-link">{{ t('ui.view_all') }}<AppIcon name="ArrowUpRight" :size="14" /></NuxtLink><button v-else class="button button-outline button-small" @click="exportCsv"><AppIcon name="Download" :size="15" />{{ t('ui.export') }}</button></div>
      <div v-if="!compact" class="wallet-history-tools"><AppDropdown v-model="filter" :label="t('ui.filter_transactions')" :options="[{ value: 'all', label: t('ui.all_transactions') }, { value: 'completed', label: t('ui.completed') }, { value: 'pending', label: t('ui.pending') }]" /><button class="text-action" :disabled="preview" @click="refreshWallet"><AppIcon name="RefreshCw" :size="14" />{{ t('ui.refresh_balance') }}</button></div>
      <div v-if="!transactions.length" class="wallet-empty"><span class="empty-icon"><AppIcon name="Wallet" :size="26" /></span><h3>{{ filter === 'all' ? t('ui.a_fresh_start_for_your_wallet') : t('ui.no_matching_transactions') }}</h3><p>{{ filter === 'all' ? t('ui.settled_funds_transfers_and_commissions_will_appear_here') : t('ui.choose_another_filter_to_see_more_activity') }}</p></div>
      <div v-for="(item, index) in compact ? transactions.slice(0, 3) : transactions" :key="item.id" class="wallet-transaction" :style="{ '--row-index': Math.min(index, 5) }">
        <span class="transaction-icon" :class="{ outgoing: item.type === 'transfer_out' || item.type === 'withdrawal', pending: item.status === 'pending' }"><AppIcon :name="item.status === 'pending' ? 'LoaderCircle' : item.type === 'transfer_out' ? 'ArrowUpRight' : 'ArrowDownLeft'" :size="18" /></span>
        <div class="transaction-info"><strong>{{ transactionDescription(item) }}</strong><span>{{ formatDate(item.createdAt, { month: 'short', day: 'numeric' }) }} · {{ item.status === 'pending' ? t('ui.pending_settlement') : t('ui.completed') }}</span></div>
        <strong class="transaction-amount" :class="{ pending: item.status === 'pending', outgoing: item.type === 'transfer_out' }">{{ item.status === 'pending' ? '' : item.type === 'transfer_out' ? '−' : '+' }}{{ money(item.amount) }}<small>USDT</small></strong>
      </div>
      <p v-if="!compact" class="wallet-history-note">{{ preview ? t('ui.sample_amounts_illustrate_the_plan_they_are_not_account_funds') : t('ui.your_wallet_is_an_internal_usdt_ledger_funding_requests_stay_pending_until_settled_on') }}</p>
    </div>
    <AppModal v-if="action" :title="action === 'deposit' ? t('ui.request_wallet_funding') : t('ui.transfer_to_a_member')" @close="closeAction">
      <div class="wallet-action-modal"><span class="modal-feature-icon"><AppIcon :name="action === 'deposit' ? 'Wallet' : 'Send'" :size="26" /></span><h2>{{ action === 'deposit' ? t('ui.a_little_fuel_for_your_wallet') : t('ui.send_to_someone_in_your_loop') }}</h2><p>{{ action === 'deposit' ? t('ui.save_a_funding_request_for_your_account_funds_become_available_only_after_verificatio') : t('ui.transfer_available_funds_instantly_to_another_loop_member') }}</p>
        <form class="account-form" @submit.prevent="submit">
          <template v-if="action === 'transfer'"><label for="transfer-recipient">{{ t('ui.recipient_username') }}</label><input id="transfer-recipient" v-model="recipient" class="auth-input" autocomplete="off" :placeholder="tr('their_username')" required maxlength="24" :disabled="loading" /></template>
          <label for="wallet-amount">{{ t('ui.amount_in_usdt') }}</label><input id="wallet-amount" v-model="amount" class="auth-input" type="text" inputmode="decimal" placeholder="0.00" pattern="[0-9]+(\.[0-9]{1,6})?" required :disabled="loading" />
          <template v-if="action === 'transfer'"><span class="available-hint">{{ t('ui.available') }} {{ money(available) }} USDT</span><label for="transfer-password">{{ t('ui.confirm_with_your_password') }}</label><input id="transfer-password" v-model="password" class="auth-input" type="password" autocomplete="current-password" :placeholder="t('ui.your_account_password')" required maxlength="128" :disabled="loading" /></template>
          <p v-if="error" class="auth-error" role="alert">{{ tr(error) }}</p>
          <button class="button button-orange auth-wallet-button" :disabled="loading" type="submit"><AppIcon v-if="loading" name="LoaderCircle" class="auth-loading" :size="17" />{{ loading ? t('ui.please_wait') : action === 'deposit' ? t('ui.save_funding_request') : t('ui.confirm_transfer') }}<AppIcon v-if="!loading" name="ArrowRight" :size="17" /></button>
        </form>
      </div>
    </AppModal>
  </section>
</template>
