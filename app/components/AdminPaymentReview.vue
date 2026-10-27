<script setup lang="ts">
import type { AdminPayment } from "../../shared/admin";
import { formatUsdt } from "#shared/plan";
const props = defineProps<{ payment: AdminPayment }>();
const emit = defineEmits<{ close: []; reviewed: [] }>();
const { t, formatDate } = useLoopI18n();
const { errorMessage } = useAdminTools();
const { notify } = useAppUI();
const decision = ref("approved");
const reference = ref("");
const note = ref("");
const verified = ref(false);
const busy = ref(false);
const error = ref("");
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await $fetch(`/api/admin/payments/${props.payment.id}`, { method: "POST", body: { decision: decision.value, reference: reference.value, note: note.value, verified: verified.value } });
    notify(t(decision.value === "approved" ? "admin.paymentApproved" : "admin.paymentRejected"));
    emit("reviewed");
  } catch (failure) { error.value = errorMessage(failure); }
  finally { busy.value = false; }
}
</script>
<template>
  <AppModal :title="t('admin.paymentReview')" @close="!busy && emit('close')"><div class="admin-dialog"><span class="admin-dialog-icon"><AppIcon name="Wallet" :size="25" /></span><h2>{{ t('admin.paymentReview') }}</h2><p>ID {{ payment.memberId }}</p><div class="admin-review-amount">{{ formatUsdt(payment.amount) }}<span>USDT</span></div><dl class="admin-details"><div><dt>{{ t('admin.requested') }}</dt><dd>{{ formatDate(payment.createdAt) }}</dd></div><div><dt>{{ t('ui.status') }}</dt><dd><span class="admin-status" :class="payment.status">{{ t(`admin.status.${payment.status}`) }}</span></dd></div><div><dt>{{ t('admin.wallet') }}</dt><dd class="admin-wrap-value">{{ payment.walletId }}</dd></div><template v-if="payment.reviewedAt"><div><dt>{{ t('admin.reviewedBy') }}</dt><dd>ID {{ payment.reviewedBy }}</dd></div><div><dt>{{ t('admin.reviewedAt') }}</dt><dd>{{ formatDate(payment.reviewedAt) }}</dd></div><div v-if="payment.reference"><dt>{{ t('admin.reference') }}</dt><dd class="admin-wrap-value">{{ payment.reference }}</dd></div><div v-if="payment.note"><dt>{{ t('admin.note') }}</dt><dd class="admin-wrap-value">{{ payment.note }}</dd></div></template></dl><form v-if="payment.status === 'pending'" class="admin-form" @submit.prevent="submit"><AppDropdown v-model="decision" :label="t('admin.decision')" :disabled="busy" :options="[{ value: 'approved', label: t('admin.approveFunding') }, { value: 'rejected', label: t('admin.rejectRequest') }]" /><template v-if="decision === 'approved'"><label for="settlement-reference">{{ t('admin.reference') }}</label><input id="settlement-reference" v-model="reference" class="auth-input" :placeholder="t('admin.referencePlaceholder')" minlength="6" maxlength="160" required :disabled="busy" /><label class="admin-checkbox"><input v-model="verified" type="checkbox" required :disabled="busy" /><span>{{ t('admin.verifyReceipt') }}</span></label></template><label for="review-note">{{ decision === 'rejected' ? t('admin.rejectionReason') : t('admin.optionalNote') }}</label><textarea id="review-note" v-model="note" rows="3" maxlength="500" :minlength="decision === 'rejected' ? 3 : 0" :required="decision === 'rejected'" :disabled="busy"></textarea><p v-if="error" class="auth-error" role="alert">{{ error }}</p><button class="button" :class="decision === 'approved' ? 'button-orange' : 'admin-danger-button'" type="submit" :disabled="busy">{{ busy ? t('ui.please_wait') : decision === 'approved' ? t('admin.confirmApproval') : t('admin.confirmRejection') }}<AppIcon name="Check" :size="17" /></button></form></div></AppModal>
</template>
