export default defineNuxtPlugin(() => {
  const route = useRoute();
  const { incomingReferral } = useIncomingReferral();
  watch(() => route.query.ref, () => { incomingReferral(); }, { immediate: true });
});
