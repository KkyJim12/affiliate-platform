<script setup lang="ts">
let previousFocus: HTMLElement | null = null;
let previousOverflow = "";
let activeElement: Element | null = null;
let locked = false;

function prepare(element: Element) {
  activeElement = element;
  if (!locked) {
    previousFocus = document.activeElement as HTMLElement | null;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    locked = true;
  }
  element.removeAttribute("aria-hidden");
  const dialog = element.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog) dialog.inert = false;
}
function retire(element: Element) {
  element.setAttribute("aria-hidden", "true");
  // Keep the backdrop blocking clicks while the departing dialog is inactive.
  const dialog = element.querySelector<HTMLElement>('[role="dialog"]');
  if (dialog) dialog.inert = true;
}
function restore() {
  if (!locked) return;
  document.body.style.overflow = previousOverflow;
  locked = false;
  activeElement = null;
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  previousFocus = null;
}
function afterLeave(element: Element) {
  if (activeElement === element) restore();
}
onBeforeUnmount(restore);
</script>

<template>
  <Transition name="modal" appear @before-enter="prepare" @before-leave="retire" @after-leave="afterLeave">
    <slot />
  </Transition>
</template>
