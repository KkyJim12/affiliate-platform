<script setup lang="ts">
import type { MatrixSlotCard, MatrixSlotCatalog } from "#shared/matrix-slots";

const props = defineProps<{ memberId: string }>();
const { t, localeTag } = useLoopI18n();
const level = ref(0), page = ref(1), detailVersion = ref(0);
const selected = ref<MatrixSlotCard | null>(null);
const catalogRoot = ref<HTMLElement | null>(null), backButton = ref<HTMLButtonElement | null>(null);
watch(level, () => { page.value = 1; }, { flush: "sync" });
const { data, status, error, refresh } = await useFetch<MatrixSlotCatalog>("/api/referrals/slots", {
  key: `matrix-slots-${props.memberId}`,query:{level,page},
});
const catalog = computed(() => data.value?.memberId === props.memberId ? data.value : null);
const current = computed(() => selected.value && (catalog.value?.items.find(slot => slot.level === selected.value!.level && slot.cycle === selected.value!.cycle) ?? selected.value));
const totals = computed(() => (catalog.value?.levels ?? []).reduce((total,row) => ({
  unlocked:total.unlocked+row.unlocked,rebirths:total.rebirths+row.rebirths,completed:total.completed+row.completed,
}),{unlocked:0,rebirths:0,completed:0}));
const pageCount = computed(() => Math.max(1,Math.ceil((catalog.value?.total ?? 0)/(catalog.value?.pageSize ?? 24))));
const slotName = (slot: MatrixSlotCard) => slot.cycle ? t('matrix.rebirthNumber',{number:slot.cycle}) : t('matrix.initialSlot');
const slotStatus = (slot: MatrixSlotCard) => t(`matrixSlots.${slot.status}`);
const number = (value: number) => value.toLocaleString(localeTag.value);
async function reload() { await refresh(); detailVersion.value++; }
function openSlot(slot: MatrixSlotCard) {
  selected.value = slot;
  nextTick(() => backButton.value?.focus());
}
function backToSlots() {
  const slot = selected.value;
  selected.value = null;
  nextTick(() => { if (slot) catalogRoot.value?.querySelector<HTMLButtonElement>(`[data-level="${slot.level}"][data-cycle="${slot.cycle}"]`)?.focus(); });
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer=setInterval(() => { if (document.visibilityState === 'visible') void refresh(); },15_000); });
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <section ref="catalogRoot" class="matrix-slots" :aria-label="t('matrixSlots.title')" data-testid="matrix-slots">
    <template v-if="current">
      <div class="slot-detail-toolbar">
        <button ref="backButton" class="button button-outline button-small" @click="backToSlots"><AppIcon name="ArrowLeft" :size="15" />{{ t('matrixSlots.back') }}</button>
        <button class="button button-outline button-small" :disabled="status === 'pending'" @click="reload"><AppIcon name="RefreshCw" :size="14" />{{ t('matrixSlots.refresh') }}</button>
      </div>
      <div class="slot-detail-heading">
        <div><span class="eyebrow">{{ t('matrix.slot') }}</span><h3>{{ t('matrixSlots.level',{level:current.level}) }} · {{ slotName(current) }}</h3></div>
        <span class="slot-status" :class="current.status">{{ slotStatus(current) }}</span>
      </div>
      <p v-if="current.status === 'locked'" class="slot-lock-note"><AppIcon name="LockKeyhole" :size="16" />{{ t('matrixSlots.lockedHint',{level:current.level}) }}</p>
      <p v-else class="slot-detail-note">{{ t('matrixSlots.paidProgress',{paid:number(current.paid),capacity:current.capacity}) }}</p>
      <p class="slot-detail-note">{{ t(current.status === 'completed' ? 'matrixSlots.completedHint' : 'matrixSlots.visibilityHint') }}</p>
      <BinaryReferralTree :key="`${memberId}-${current.level}-${current.cycle}-${detailVersion}`" :member-id="memberId" :initial-level="current.level" :initial-cycle="current.cycle" fixed-selection live />
    </template>
    <template v-else>
      <div v-if="catalog" class="slot-totals">
        <div><AppIcon name="Layers" :size="19" /><span>{{ t('matrixSlots.unlockedCount') }}<strong>{{ number(totals.unlocked) }}</strong></span></div>
        <div><AppIcon name="RefreshCw" :size="19" /><span>{{ t('matrixSlots.rebirthCount') }}<strong>{{ number(totals.rebirths) }}</strong></span></div>
        <div><AppIcon name="CheckCircle2" :size="19" /><span>{{ t('matrixSlots.completedCount') }}<strong>{{ number(totals.completed) }}</strong></span></div>
      </div>
      <div class="slot-catalog-toolbar">
        <AppDropdown v-model="level" :label="t('matrixSlots.filterLevel')" compact :options="[{value:0,label:t('matrixSlots.allLevels')},...Array.from({length:15},(_,index)=>({value:index+1,label:t('matrixSlots.level',{level:index+1})}))]" />
        <button class="button button-outline button-small" :disabled="status === 'pending'" @click="reload"><AppIcon name="RefreshCw" :size="14" />{{ t('matrixSlots.refresh') }}</button>
      </div>
      <p v-if="error" class="slot-message" role="alert">{{ t('matrixSlots.loadError') }}</p>
      <p v-else-if="!catalog" class="slot-message" role="status">{{ t('matrixSlots.loading') }}</p>
      <template v-if="catalog">
        <div class="slot-grid" :aria-busy="status === 'pending'">
          <button v-for="slot in catalog.items" :key="`${slot.level}-${slot.cycle}`" class="matrix-slot-card" :class="slot.status"
            :data-level="slot.level" :data-cycle="slot.cycle" :data-status="slot.status" data-testid="matrix-slot-card"
            :aria-label="t('matrixSlots.openSlot',{level:slot.level,slot:slotName(slot)})" @click="openSlot(slot)">
            <span class="slot-card-top"><span class="slot-card-icon"><AppIcon :name="slot.status === 'locked' ? 'LockKeyhole' : 'GitFork'" :size="21" /></span><span class="slot-status" :class="slot.status">{{ slotStatus(slot) }}</span></span>
            <span class="slot-card-level">{{ t('matrixSlots.level',{level:slot.level}) }}</span>
            <strong class="slot-card-name">{{ slotName(slot) }}</strong>
            <span class="slot-card-progress">{{ t('matrixSlots.paidProgress',{paid:number(slot.paid),capacity:slot.capacity}) }}</span>
            <span class="slot-progress-track" aria-hidden="true"><span :style="{width:`${slot.paid/slot.capacity*100}%`}"></span></span>
            <span class="slot-card-reserved">{{ t('matrixSlots.reservedProgress',{filled:number(slot.filled),capacity:slot.capacity}) }}</span>
            <span class="slot-card-action">{{ t(slot.status === 'locked' ? 'matrixSlots.previewTree' : slot.status === 'completed' ? 'matrixSlots.viewCompletedTree' : 'matrixSlots.viewTree') }}<AppIcon name="ArrowUpRight" :size="16" /></span>
          </button>
        </div>
        <p v-if="!catalog.items.length" class="slot-message">{{ t('matrixSlots.empty') }}</p>
        <div v-if="pageCount > 1" class="slot-pagination" :aria-label="t('matrixSlots.pagination')">
          <button class="button button-outline button-small" :disabled="page <= 1 || status === 'pending'" @click="page--">{{ t('matrixSlots.previous') }}</button>
          <span>{{ t('matrixSlots.page',{page:number(page),pages:number(pageCount)}) }}</span>
          <button class="button button-outline button-small" :disabled="page >= pageCount || status === 'pending'" @click="page++">{{ t('matrixSlots.next') }}</button>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.matrix-slots { min-width: 0; }
.slot-totals { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; margin: 8px 0 24px; }
.slot-totals > div { display: flex; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: 12px; color: var(--gold-text); background: var(--surface); }
.slot-totals span { display: grid; gap: 9px; color: var(--text-secondary); font-size: 11px; }.slot-totals strong { color: var(--text-primary); font-size: 24px; font-weight: 600; }
.slot-catalog-toolbar, .slot-detail-toolbar, .slot-detail-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
.slot-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(min(100%,235px),1fr)); gap: 16px; }
.matrix-slot-card { min-width: 0; display: flex; flex-direction: column; align-items: stretch; padding: 20px; border: 1px solid var(--gold-border); border-radius: 15px; color: var(--text-primary); background: var(--surface); text-align: left; cursor: pointer; transition: border-color .15s,background .15s,box-shadow .15s; }
.matrix-slot-card:hover, .matrix-slot-card:focus-visible { border-color: var(--gold); background: var(--gold-soft); box-shadow: 0 5px 18px rgb(0 0 0 / 5%); }.matrix-slot-card:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }
.matrix-slot-card.locked { border-color: var(--border); }.matrix-slot-card.completed { border-color: var(--gold-border); }
.slot-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 20px; }
.slot-card-icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: var(--gold-soft); color: var(--gold-text); }.locked .slot-card-icon { color: var(--text-secondary); background: var(--tree-bg); }
.slot-status { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 20px; padding: 5px 9px; font-size: 10px; line-height: 1.5; color: var(--text-secondary); }.slot-status.open { border-color: var(--gold-border); color: var(--gold-text); background: var(--gold-soft); }.slot-status.completed { color: var(--success); background: var(--success-soft); border-color: var(--success); }
.slot-card-level { color: var(--gold-text); font-size: 11px; font-weight: 600; }.slot-card-name { font-size: 19px; margin: 7px 0 22px; overflow-wrap: anywhere; font-weight: 600; }
.slot-card-progress, .slot-card-reserved { color: var(--text-secondary); font-size: 11px; line-height: 1.6; }.slot-card-progress { color: var(--text-primary); }
.slot-progress-track { display: block; height: 5px; border-radius: 6px; background: var(--border); overflow: hidden; margin: 9px 0; }.slot-progress-track > span { display: block; height: 100%; background: var(--gold); border-radius: inherit; }.completed .slot-progress-track > span { background: var(--success); }
.slot-card-action { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--border); padding-top: 15px; margin-top: 20px; color: var(--gold-text); font-size: 12px; font-weight: 600; }
.slot-detail-heading h3 { margin: 8px 0; font-size: 22px; overflow-wrap: anywhere; }.slot-lock-note, .slot-detail-note { font-size: 12px; line-height: 1.8; color: var(--text-secondary); margin-bottom: 18px; }.slot-lock-note { display: flex; align-items: center; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: 10px; }.slot-lock-note svg { flex-shrink: 0; }
.slot-pagination { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 14px; margin-top: 24px; font-size: 11px; color: var(--text-secondary); }.slot-message { padding: 32px 12px; color: var(--text-secondary); text-align: center; font-size: 13px; line-height: 1.7; }
@media (max-width:600px) { .slot-totals { gap: 6px; }.slot-totals > div { padding: 12px 9px; display: block; }.slot-totals svg { margin-bottom: 8px; }.slot-totals span { font-size: 10px; }.slot-totals strong { font-size: 21px; }.slot-grid { gap: 12px; }.slot-detail-heading h3 { font-size: 19px; } }
</style>
