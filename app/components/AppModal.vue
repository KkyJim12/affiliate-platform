<script setup lang="ts">
const { t, tr, localeTag, formatDate } = useLoopI18n();

const props = defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let previousOverflow = "";
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") emit("close");
  if (event.key !== "Tab") return;
  const focusables = dialog.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]',
  );
  if (!focusables?.length) return;
  const first = focusables[0]!,
    last = focusables[focusables.length - 1]!;
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === dialog.value)
  ) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
onMounted(() => {
  previousFocus = document.activeElement as HTMLElement;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  dialog.value?.focus({ preventScroll: true });
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.body.style.overflow = previousOverflow;
  document.removeEventListener("keydown", onKeydown);
  previousFocus?.focus({ preventScroll: true });
});
</script>
<template>
  <Teleport to="body"
    ><div class="modal-backdrop" @click.self="emit('close')">
      <section
        ref="dialog"
        class="modal-card"
        role="dialog"
        aria-modal="true"
        :aria-label="props.title"
        tabindex="-1"
      >
        <button
          class="icon-button modal-close"
          :aria-label="t('ui.close_dialog')"
          @click="emit('close')"
        >
          <AppIcon name="X" :size="20" /></button
        ><slot />
      </section></div
  ></Teleport>
</template>
