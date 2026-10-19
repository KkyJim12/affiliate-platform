<script setup lang="ts">
import { baseReferralPrice, bonusPoolRate, bonusRate, directRates, ledgerScale, levelPrice, maxReferralLevel, platformFeeRate, purchaseShares } from "#shared/compensation";

const { t, localeTag } = useLoopI18n();
const selectedLevel = ref(1);
const levels = Array.from({ length: maxReferralLevel }, (_, index) => ({ level: index + 1, price: levelPrice(index + 1) }));
const price = computed(() => levelPrice(selectedLevel.value));
const totalCost = computed(() => levels.slice(0, selectedLevel.value).reduce((sum, level) => sum + level.price, 0));
const shares = computed(() => purchaseShares(selectedLevel.value));
const rows = computed(() => Array.from({ length: maxReferralLevel }, (_, index) => {
  const depth = index + 1;
  const direct = shares.value.find(share => share.kind === "direct" && share.depth === depth)?.units ?? 0;
  const bonus = shares.value.find(share => share.kind === "bonus" && share.depth === depth)!.units;
  return { depth, direct: direct / ledgerScale, bonus: bonus / ledgerScale, total: (direct + bonus) / ledgerScale,
    directRate: directRates[index] ?? 0, bonusRate: bonusRate(depth) };
}));
const pools = computed(() => [
  { kind: "direct", percent: 80, amount: shares.value.filter(share => share.kind === "direct").reduce((sum, share) => sum + share.units, 0) / ledgerScale },
  { kind: "bonus", percent: bonusPoolRate * 100, amount: shares.value.filter(share => share.kind === "bonus").reduce((sum, share) => sum + share.units, 0) / ledgerScale },
  { kind: "platform", percent: platformFeeRate * 100, amount: shares.value.find(share => share.kind === "platform")!.units / ledgerScale },
]);
const money = (value: number) => value.toLocaleString(localeTag.value, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const percent = (value: number) => (value * 100).toLocaleString(localeTag.value, { maximumFractionDigits: 6 });
</script>

<template>
  <div class="referral-ranks" data-testid="referral-ranks">
    <section class="panel level-rules">
      <div class="level-rules-heading"><span class="modal-feature-icon"><AppIcon name="Layers" :size="24" /></span><div><h2>{{ t('ranksPage.rulesTitle') }}</h2><p>{{ t('ranksPage.rulesHint') }}</p></div></div>
      <div class="level-facts">
        <div><span>{{ t('ranksPage.activation') }}</span><strong>{{ money(baseReferralPrice) }} <small>USDT</small></strong><p>{{ t('ranksPage.activationHint') }}</p></div>
        <div><span>{{ t('ranksPage.upgrade') }}</span><strong>2× <small>{{ t('ranksPage.eachLevel') }}</small></strong><p>{{ t('ranksPage.upgradeHint') }}</p></div>
        <div><span>{{ t('ranksPage.maximum') }}</span><strong>{{ maxReferralLevel }} <small>{{ t('ranksPage.levels') }}</small></strong><p>{{ money(levelPrice(maxReferralLevel)) }} USDT · {{ t('ranksPage.finalPrice') }}</p></div>
      </div>
      <div class="level-network-note"><AppIcon name="Info" :size="16" /><p>{{ t('ranksPage.paymentHint') }}</p></div>
    </section>

    <section class="level-selection" :aria-label="t('ranksPage.selectLevel')">
      <div class="level-section-heading"><h2>{{ t('ranksPage.selectLevel') }}</h2><span>{{ t('ranksPage.priceHint') }}</span></div>
      <div class="rank-grid"><button v-for="item in levels" :key="item.level" class="rank-card" :class="{ selected: selectedLevel === item.level }" :aria-pressed="selectedLevel === item.level" @click="selectedLevel = item.level">
        <span class="rank-number">{{ t('ranksPage.level') }} {{ String(item.level).padStart(2, '0') }}<AppIcon v-if="selectedLevel === item.level" name="CheckCircle2" :size="17" /><AppIcon v-else name="Layers" :size="16" /></span>
        <strong>{{ item.price.toLocaleString(localeTag) }}<small>USDT</small></strong>
        <span>{{ t(item.level === 1 ? 'ranksPage.activation' : 'ranksPage.upgradePurchase') }}</span>
      </button></div>
    </section>

    <section class="panel level-distribution" aria-live="polite">
      <div class="section-card-header"><div><h2>{{ t('ranksPage.purchaseTitle', { level: selectedLevel }) }}</h2><p>{{ t('ranksPage.purchaseHint') }}</p></div><span class="level-price" data-testid="level-purchase-price">{{ money(price) }} <small>USDT</small></span></div>
      <div class="level-distribution-bar" role="img" :aria-label="t('ranksPage.splitLabel')"><span v-for="pool in pools" :key="pool.kind" :class="`pool-${pool.kind}`" :style="{ flex: pool.percent }" /></div>
      <div class="level-pools"><div v-for="pool in pools" :key="pool.kind" :class="`pool-${pool.kind}`"><span><i />{{ t(`ranksPage.${pool.kind}`) }}</span><strong>{{ pool.percent }}% <small>· {{ money(pool.amount) }} USDT</small></strong><p>{{ t(`ranksPage.${pool.kind}Hint`) }}</p></div></div>
      <div class="level-cost"><span>{{ t('ranksPage.totalCost', { level: selectedLevel }) }}</span><strong data-testid="level-total-cost">{{ money(totalCost) }} USDT</strong><p>{{ t('ranksPage.fullPriceHint') }}</p></div>
    </section>

    <section class="panel level-payouts">
      <div class="section-card-header"><div><h2>{{ t('ranksPage.payoutTitle') }}</h2><p>{{ t('ranksPage.payoutHint', { level: selectedLevel }) }}</p></div><span class="sample-label">{{ t('ranksPage.onePurchase') }}</span></div>
      <div class="table-scroll"><table data-testid="level-payouts"><thead><tr><th scope="col">{{ t('ranksPage.upline') }}</th><th scope="col">{{ t('ranksPage.directAmount') }}</th><th scope="col">{{ t('ranksPage.bonusAmount') }}</th><th scope="col">{{ t('ranksPage.totalAmount') }}</th></tr></thead>
        <tbody><tr v-for="row in rows" :key="row.depth"><th scope="row">{{ t('ranksPage.uplineNumber', { depth: row.depth }) }}<small v-if="row.depth === 1">{{ t('ranksPage.sponsor') }}</small></th><td>{{ money(row.direct) }}<small>{{ percent(row.directRate) }}%</small></td><td>{{ money(row.bonus) }}<small>≈ {{ percent(row.bonusRate) }}%</small></td><td class="number-cell">{{ money(row.total) }}</td></tr></tbody>
        <tfoot><tr><th scope="row">{{ t('ranksPage.uplineTotal') }}</th><td>{{ money(pools[0]!.amount) }}</td><td>{{ money(pools[1]!.amount) }}</td><td data-testid="level-upline-total">{{ money(price - pools[2]!.amount) }}</td></tr></tfoot>
      </table></div>
      <div class="level-payout-footer"><div><span>{{ t('ranksPage.platform') }} · 5%</span><strong>{{ money(pools[2]!.amount) }} USDT</strong></div><div><span>{{ t('ranksPage.distributed') }} · 100%</span><strong>{{ money(price) }} USDT</strong></div></div>
      <p class="level-rounding-note">{{ t('ranksPage.roundingHint') }}</p>
    </section>

    <div class="level-details-grid">
      <section class="panel level-detail"><span class="level-detail-icon"><AppIcon name="Users" :size="21" /></span><h2>{{ t('ranksPage.eligibility') }}</h2><p>{{ t('ranksPage.uplineHint') }}</p><p>{{ t('ranksPage.eligibilityHint') }}</p><p>{{ t('ranksPage.missingHint') }}</p></section>
      <section class="panel level-detail"><span class="level-detail-icon"><AppIcon name="Wallet" :size="21" /></span><h2>{{ t('ranksPage.settlement') }}</h2><p>{{ t('ranksPage.settlementHint') }}</p><p>{{ t('ranksPage.feeHint') }}</p><NuxtLink to="/referrals" class="button button-orange button-small">{{ t('ranksPage.openPurchases') }}<AppIcon name="ArrowUpRight" :size="16" /></NuxtLink></section>
    </div>
  </div>
</template>

<style scoped>
.referral-ranks { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
.level-rules, .level-detail { padding: 26px; }
.level-rules-heading { display: flex; align-items: center; gap: 16px; }
.level-rules-heading .modal-feature-icon { margin: 0; flex-shrink: 0; }
.level-rules h2, .level-section-heading h2, .level-detail h2 { color: var(--text-primary); font: 650 17px var(--heading); }
.level-rules p, .level-detail p { color: var(--text-secondary); font-size: 12px; line-height: 1.9; }
.level-rules-heading p { margin-top: 6px; }
.level-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin: 24px 0; }
.level-facts > div + div { border-left: 1px solid var(--border); padding-left: 24px; }
.level-facts span { font-size: 12px; color: var(--text-secondary); }
.level-facts strong { display: block; margin: 10px 0 6px; font: 650 27px var(--heading); color: var(--text-primary); }
.level-facts strong small { font: 500 12px var(--font); color: var(--text-secondary); }
.level-network-note { display: flex; align-items: flex-start; gap: 10px; padding: 14px; background: var(--surface-alt); border-radius: 10px; }
.level-network-note svg { flex-shrink: 0; color: var(--gold-text); margin-top: 3px; }
.level-section-heading { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.level-section-heading > span { font-size: 12px; color: var(--text-secondary); }
.level-distribution .section-card-header, .level-payouts .section-card-header { align-items: flex-start; gap: 16px; }
.level-price { font: 650 26px var(--heading); color: var(--gold-text); white-space: nowrap; }
.level-price small { font: 500 11px var(--font); }
.level-distribution-bar { display: flex; gap: 4px; height: 12px; margin: 0 24px 20px; border-radius: 6px; overflow: hidden; }
.level-distribution-bar .pool-direct { background: var(--gold); }
.level-distribution-bar .pool-bonus { background: var(--success); }
.level-distribution-bar .pool-platform { background: #8493ad; }
.level-pools { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; padding: 0 24px 24px; }
.level-pools > div > span { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
.level-pools i { width: 8px; height: 8px; border-radius: 50%; background: var(--gold); flex-shrink: 0; }
.pool-bonus i { background: var(--success); }
.pool-platform i { background: #8493ad; }
.level-pools strong { display: block; margin-top: 10px; font: 650 22px var(--heading); color: var(--text-primary); }
.level-pools strong small { font: 500 12px var(--font); white-space: nowrap; }
.level-pools p { color: var(--text-secondary); font-size: 12px; line-height: 1.8; margin-top: 8px; }
.level-cost { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; padding: 18px 24px; border-top: 1px solid var(--border); background: var(--surface-alt); border-radius: 0 0 13px 13px; }
.level-cost > span { color: var(--text-secondary); font-size: 12px; }
.level-cost strong { font-size: 14px; }
.level-cost p { flex-basis: 100%; color: var(--text-secondary); font-size: 11px; line-height: 1.8; }
.level-payouts table { width: 100%; }
.level-payouts :is(td, th) { white-space: nowrap; }
.level-payouts tbody th { font-size: 12px; font-weight: 600; color: var(--text-primary); letter-spacing: 0; text-transform: none; }
.level-payouts small { display: block; color: var(--text-secondary); font-size: 10px; font-weight: 400; margin-top: 5px; }
.level-payout-footer { padding: 18px 24px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 14px; border-top: 1px solid var(--border); }
.level-payout-footer span, .level-payout-footer strong { display: block; font-size: 12px; }
.level-payout-footer span { color: var(--text-secondary); margin-bottom: 6px; }
.level-rounding-note { color: var(--text-secondary); font-size: 11px; line-height: 1.8; padding: 0 24px 20px; }
.level-details-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.level-detail-icon { display: inline-flex; color: var(--gold-text); margin-bottom: 12px; }
.level-detail p { margin-top: 12px; }
.level-detail .button { margin-top: 20px; }
@media (max-width: 1050px) {
  .level-pools { grid-template-columns: 1fr; }
  .level-pools > div { padding: 12px 0; border-top: 1px solid var(--border); }
  .level-pools > div:first-child { border-top: 0; padding-top: 0; }
}
@media (max-width: 650px) {
  .referral-ranks { gap: 18px; }
  .level-rules, .level-detail { padding: 20px; }
  .level-rules-heading { align-items: flex-start; }
  .level-facts, .level-details-grid { grid-template-columns: 1fr; gap: 18px; }
  .level-facts > div + div { border-left: 0; padding-left: 0; padding-top: 18px; border-top: 1px solid var(--border); }
  .level-distribution .section-card-header { flex-direction: column; }
  .level-distribution-bar { margin-inline: 18px; }
  .level-pools, .level-payout-footer { padding-inline: 18px; }
  .level-cost { padding: 18px; }
  .level-rounding-note { padding: 0 18px 18px; }
  .level-payouts table { min-width: 510px; }
  .level-detail .button { white-space: normal; text-align: center; }
}
</style>
