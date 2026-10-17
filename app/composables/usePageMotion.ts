import type { MaybeRefOrGetter, Ref } from "vue";

const revealTargets = [
  ".hero-copy > *", ".referral-visual", ".integrations", ".section-intro", ".step",
  ".rewards-copy", ".calculator-card", ".faq-section > div", ".final-cta", ".landing-footer",
  ".dashboard-heading", ".network-banner", ".network-stat", ".matrix-panel", ".balance-card",
  ".wallet-detail", ".wallet-history", ".distribution-panel", ".invite-share-panel", ".member-panel",
  ".rank-intro", ".rank-card", ".rank-detail-grid > .panel", ".unilevel-table",
  ".account-settings", ".dashboard-footer",
  ".admin-page-heading", ".admin-stat", ".admin-panel", ".admin-info-strip",
].join(",");

// Enhance visible content after hydration; server-rendered pages never start hidden.
export function usePageMotion(root: Ref<HTMLElement | null>, view?: MaybeRefOrGetter<string>) {
  const seen = new WeakSet<HTMLElement>();
  const pending = new Set<HTMLElement>();
  const animations = new Map<HTMLElement, Animation>();
  let observer: IntersectionObserver | undefined;
  let mutations: MutationObserver | undefined;
  let preference: MediaQueryList | undefined;
  let frame = 0;
  let mounted = false;

  function show(element: HTMLElement) {
    observer?.unobserve(element);
    pending.delete(element);
    animations.get(element)?.cancel();
    animations.delete(element);
    element.dataset.motionState = "visible";
  }
  function reveal(element: HTMLElement, delay = 0) {
    show(element);
    if (preference?.matches || document.hidden || element.contains(document.activeElement) || !element.animate) return;
    element.dataset.motionState = "revealing";
    const frames: Keyframe[] = element.hasAttribute("data-motion-lift") ? [
      { opacity: 0, translate: "0 18px" },
      { opacity: 1, translate: "0 0" },
    ] : [{ opacity: 0 }, { opacity: 1 }];
    const animation = element.animate(frames, { duration: 560, delay, easing: "cubic-bezier(.16, 1, .3, 1)", fill: "backwards" });
    animations.set(element, animation);
    const finish = () => {
      if (animations.get(element) !== animation) return;
      animations.delete(element);
      element.dataset.motionState = "visible";
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
  }
  function scan() {
    frame = 0;
    if (!root.value) return;
    for (const element of root.value.querySelectorAll<HTMLElement>(revealTargets)) {
      if (seen.has(element)) continue;
      seen.add(element);
      // Controls keep their hit targets in place, including when focus cancels a reveal.
      const interactive = "a, button, input, select, textarea, [tabindex]";
      element.toggleAttribute("data-motion-lift", !element.matches(interactive) && !element.querySelector(interactive));
      if (preference?.matches || !observer) { show(element); continue; }
      element.dataset.motionState = "pending";
      pending.add(element);
      observer.observe(element);
    }
    // Removed views must not leave observers or animations behind.
    for (const element of [...pending, ...animations.keys()]) if (!root.value.contains(element)) show(element);
  }
  function scanSoon() {
    if (!frame) frame = requestAnimationFrame(scan);
  }
  function onFocus(event: FocusEvent) {
    if (!(event.target instanceof Element)) return;
    // A keyboard user can focus a control before its scroll reveal has run.
    for (const element of [...pending, ...animations.keys()]) if (element.contains(event.target)) show(element);
  }
  function onPreferenceChange() {
    if (preference?.matches) {
      for (const element of [...pending, ...animations.keys()]) show(element);
    } else scanSoon();
  }
  function onVisibilityChange() {
    root.value?.toggleAttribute("data-motion-paused", document.hidden);
    if (document.hidden) for (const element of animations.keys()) show(element);
  }
  onMounted(() => {
    if (!root.value) return;
    mounted = true;
    preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        let index = 0;
        for (const entry of entries) {
          if (entry.isIntersecting) reveal(entry.target as HTMLElement, Math.min(index++, 4) * 45);
        }
      }, { threshold: 0.06, rootMargin: "0px 0px 32px 0px" });
    }
    mutations = new MutationObserver((records) => {
      if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE))) scanSoon();
    });
    mutations.observe(root.value, { childList: true, subtree: true });
    root.value.addEventListener("focusin", onFocus);
    preference.addEventListener("change", onPreferenceChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    onVisibilityChange();
    scan();
  });
  if (view) watch(() => toValue(view), async () => {
    await nextTick();
    if (!mounted || !root.value) return;
    for (const element of root.value.querySelectorAll<HTMLElement>(revealTargets)) {
      show(element);
      seen.delete(element);
    }
    scan();
    const heading = root.value.querySelector<HTMLElement>(".dashboard-heading");
    if (heading) reveal(heading);
  });
  onBeforeUnmount(() => {
    mounted = false;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    mutations?.disconnect();
    preference?.removeEventListener("change", onPreferenceChange);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    root.value?.removeEventListener("focusin", onFocus);
    for (const element of [...pending, ...animations.keys()]) show(element);
  });
}
