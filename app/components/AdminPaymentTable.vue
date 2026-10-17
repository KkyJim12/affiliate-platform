<script setup lang="ts">
import type { AdminPayment } from "../../shared/admin";
import { formatUsdt } from "#shared/plan";
defineProps<{ items: AdminPayment[] }>();
defineEmits<{ review: [payment: AdminPayment] }>();
const { t, formatDate } = useLoopI18n();
</script>
<template>
  <div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>{{ t('admin.member') }}</th><th>{{ t('admin.requested') }}</th><th>{{ t('admin.amount') }}</th><th>{{ t('ui.status') }}</th><th><span class="sr-only">{{ t('admin.actions') }}</span></th></tr></thead><tbody><tr v-for="payment in items" :key="payment.id"><td><div class="admin-table-identity"><span class="admin-table-avatar">{{ payment.username.slice(0, 2).toUpperCase() }}</span><div><strong>@{{ payment.username }}</strong><small>{{ payment.reference || payment.id.slice(0, 8).toUpperCase() }}</small></div></div></td><td>{{ formatDate(payment.createdAt) }}</td><td class="admin-money">{{ formatUsdt(payment.amount) }} <small>USDT</small></td><td><span class="admin-status" :class="payment.status"><i></i>{{ t(`admin.status.${payment.status}`) }}</span></td><td><button class="admin-text-button" @click="$emit('review', payment)">{{ payment.status === 'pending' ? t('admin.review') : t('admin.details') }}<AppIcon name="ArrowUpRight" :size="14" /></button></td></tr><tr v-if="!items.length"><td colspan="5"><div class="admin-empty"><AppIcon name="Wallet" :size="29" /><strong>{{ t('admin.noPayments') }}</strong><p>{{ t('admin.noPaymentsHint') }}</p></div></td></tr></tbody></table></div>
</template>
