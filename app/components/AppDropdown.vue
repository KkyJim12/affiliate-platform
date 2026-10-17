<script setup lang="ts" generic="T extends string | number">
const props = defineProps<{
  modelValue: T;
  options: ReadonlyArray<{ value: T; label: string; shortLabel?: string }>;
  label: string;
  id?: string;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: T] }>();
const uid = useId();
const triggerId = computed(() => props.id || `dropdown-${uid}`);
const listId = `dropdown-list-${uid}`;
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLUListElement | null>(null);
const open = ref(false);
const activeIndex = ref(0);
const selected = computed(() => props.options.find((option) => option.value === props.modelValue));
const menuStyle = ref<Record<string, string>>({ visibility: "hidden" });
let typed = "";
let lastTypedAt = 0;

function positionMenu() {
  if (!open.value || !trigger.value || !menu.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  if (rect.bottom < 0 || rect.top > height) { open.value = false; return; }
  const below = height - rect.bottom - 18;
  const above = rect.top - 18;
  const flip = below < Math.min(menu.value.scrollHeight, 240) && above > below;
  const maxHeight = Math.max(48, Math.min(320, flip ? above : below));
  const menuHeight = Math.min(menu.value.scrollHeight, maxHeight);
  const menuWidth = Math.min(Math.max(rect.width, 192), width - 24);
  menuStyle.value = {
    width: `${menuWidth}px`,
    left: `${Math.max(12, Math.min(rect.left, width - menuWidth - 12))}px`,
    top: `${Math.max(12, flip ? rect.top - menuHeight - 7 : rect.bottom + 7)}px`,
    maxHeight: `${maxHeight}px`,
    visibility: "visible",
  };
}
function revealActive() {
  const option = menu.value?.children[activeIndex.value] as HTMLElement | undefined;
  if (!option || !menu.value) return;
  if (option.offsetTop < menu.value.scrollTop) menu.value.scrollTop = option.offsetTop;
  else if (option.offsetTop + option.offsetHeight > menu.value.scrollTop + menu.value.clientHeight) {
    menu.value.scrollTop = option.offsetTop + option.offsetHeight - menu.value.clientHeight;
  }
}
function show() {
  if (props.disabled || props.busy || !props.options.length) return;
  // Keyboard focus can start a smooth page scroll before the menu opens.
  // Bring its anchor into view immediately so that scroll cannot dismiss it.
  const rect = trigger.value?.getBoundingClientRect();
  if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
    trigger.value?.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  }
  activeIndex.value = Math.max(0, props.options.findIndex((option) => option.value === props.modelValue));
  menuStyle.value = { visibility: "hidden" };
  open.value = true;
}
function choose(index: number, restoreFocus = true) {
  const option = props.options[index];
  if (!option || props.disabled || props.busy) return;
  open.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
  emit("update:modelValue", option.value);
}
function onKeydown(event: KeyboardEvent) {
  if (props.disabled || props.busy) return;
  if (event.key === "Escape" && open.value) {
    event.preventDefault();
    event.stopPropagation();
    open.value = false;
    return;
  }
  if (event.key === "Tab") {
    if (open.value) choose(activeIndex.value, false);
    return;
  }
  if (["Enter", " "].includes(event.key)) {
    event.preventDefault();
    if (open.value) choose(activeIndex.value);
    else show();
    return;
  }
  if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) {
    event.preventDefault();
    if (open.value && event.altKey && event.key === "ArrowUp") { choose(activeIndex.value); return; }
    const wasOpen = open.value;
    if (!wasOpen) show();
    if (event.key === "Home") activeIndex.value = 0;
    else if (event.key === "End") activeIndex.value = props.options.length - 1;
    else if (wasOpen) {
      const step = event.key === "PageDown" ? 10 : event.key === "PageUp" ? -10 : event.key === "ArrowDown" ? 1 : -1;
      activeIndex.value = Math.max(0, Math.min(props.options.length - 1, activeIndex.value + step));
    }
    return;
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (!open.value) show();
    const now = Date.now();
    typed = now - lastTypedAt < 700 ? typed + event.key : event.key;
    lastTypedAt = now;
    const repeated = [...typed].every((letter) => letter === typed[0]);
    const query = (repeated ? event.key : typed).toLocaleLowerCase();
    const start = repeated ? activeIndex.value + 1 : 0;
    for (let offset = 0; offset < props.options.length; offset++) {
      const index = (start + offset) % props.options.length;
      if (props.options[index]!.label.toLocaleLowerCase().startsWith(query)) { activeIndex.value = index; break; }
    }
  }
}
function outside(event: Event) {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (!trigger.value?.contains(target) && !menu.value?.contains(target)) open.value = false;
}
function onScroll(event: Event) {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return;
  positionMenu();
}
function prepareMenu(element: Element) {
  element.removeAttribute("aria-hidden");
  element.setAttribute("aria-label", props.label);
  (element as HTMLElement).inert = false;
}
function retireMenu(element: Element) {
  element.setAttribute("aria-hidden", "true");
  element.removeAttribute("aria-label");
  (element as HTMLElement).inert = true;
}
watch(open, async (value) => {
  if (!value) { typed = ""; return; }
  await nextTick();
  positionMenu();
  await nextTick();
  revealActive();
});
watch(activeIndex, () => nextTick(revealActive));
watch(() => [props.label, props.options], () => { if (open.value) nextTick(positionMenu); });
watch(() => props.disabled || props.busy, (value) => { if (value) open.value = false; });
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", outside);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", positionMenu);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", outside);
  window.removeEventListener("scroll", onScroll, true);
  window.removeEventListener("resize", positionMenu);
});
</script>

<template>
  <div class="app-dropdown" :class="{ 'dropdown-compact': compact }">
    <button
      :id="triggerId" ref="trigger" type="button" class="dropdown-trigger" role="combobox"
      :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? listId : undefined"
      :aria-activedescendant="open ? `${listId}-${activeIndex}` : undefined"
      :aria-disabled="disabled || busy || undefined" :aria-busy="busy || undefined" :disabled="disabled"
      :data-value="modelValue" @click="open ? (open = false) : show()" @keydown="onKeydown"
    >
      <slot name="leading" />
      <span class="dropdown-value">{{ selected?.shortLabel || selected?.label }}</span>
      <AppIcon name="ChevronDown" :size="14" class="dropdown-chevron" :class="{ rotated: open }" />
    </button>
    <Teleport to="body">
      <Transition name="dropdown" @before-enter="prepareMenu" @before-leave="retireMenu">
      <ul v-if="open" :id="listId" ref="menu" class="dropdown-menu" role="listbox" :aria-label="label" :style="menuStyle" @mousedown.prevent>
        <li v-for="(option, index) in options" :id="`${listId}-${index}`" :key="option.value" role="option"
          :aria-selected="option.value === modelValue" :data-value="option.value"
          class="dropdown-option" :class="{ active: index === activeIndex, selected: option.value === modelValue }"
          @pointermove="activeIndex = index" @click="choose(index)"
        ><span>{{ option.label }}</span><AppIcon v-if="option.value === modelValue" name="Check" :size="15" /></li>
      </ul>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.app-dropdown { display: inline-flex; min-width: 0; flex-shrink: 0; max-width: 100%; }
.dropdown-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: 9px; width: 100%; min-height: 39px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 9px; background: var(--surface-alt); color: var(--text-primary); font-size: 11px; line-height: 1.5; text-align: left; transition: border-color .15s, background .15s; }
.dropdown-trigger:hover, .dropdown-trigger[aria-expanded='true'] { border-color: var(--gold-border); background: var(--surface); }
.dropdown-trigger[aria-expanded='true'] { box-shadow: 0 0 0 2px var(--gold-glow); }
.dropdown-trigger[aria-busy='true'] { cursor: progress; opacity: .65; }
.dropdown-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dropdown-chevron { margin-left: auto; color: var(--text-secondary); transition: transform .15s; }
.dropdown-chevron.rotated { transform: rotate(180deg); }
.dropdown-compact .dropdown-trigger { min-height: 34px; padding: 8px 9px; gap: 6px; font-size: 10px; }
.dropdown-menu { position: fixed; z-index: 2000; margin: 0; padding: 6px; list-style: none; overflow-y: auto; overscroll-behavior: contain; border: 1px solid var(--gold-border); border-radius: 12px; background: var(--surface-raised); color: var(--text-primary); box-shadow: 0 14px 40px #00000024, 0 3px 9px #0000000d; font: 12px/1.6 var(--font); scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.dropdown-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 38px; padding: 9px 10px; border-radius: 7px; cursor: pointer; user-select: none; overflow-wrap: anywhere; }
.dropdown-option.active { background: var(--gold-soft); }
.dropdown-option.selected { color: var(--gold-text); font-weight: 650; }
@media (max-width: 760px) {
  .dropdown-menu { font-size: 12px; }
  .dropdown-option { min-height: 42px; }
  .dropdown-trigger { font-size: 10px; padding: 9px; }
}
@media (prefers-reduced-motion: reduce) { .dropdown-trigger, .dropdown-chevron { transition: none; } }
</style>
