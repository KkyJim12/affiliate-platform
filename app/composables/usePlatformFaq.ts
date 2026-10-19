export function usePlatformFaq() {
  const { t } = useLoopI18n();
  const external = useRuntimeConfig().public.walletMode !== "embedded";
  const faqs = computed(() => [
    { q: t("platformFaq.networkQuestion"), a: t("platformFaq.networkAnswer") },
    { q: t("platformFaq.walletQuestion"), a: t(external ? "platformFaq.walletAnswer" : "platformFaq.embeddedAnswer") },
    { q: t("platformFaq.commissionsQuestion"), a: t("platformFaq.commissionsAnswer") },
    { q: t("platformFaq.testnetQuestion"), a: t("platformFaq.testnetAnswer") },
  ]);
  return { faqs };
}
