export default defineNuxtPlugin({
  name: "locale-preference",
  dependsOn: ["i18n:plugin:route-locale-detect"],
  async setup(nuxtApp) {
    // Apply the saved choice during SSR and hydration; new visitors start in Thai.
    const preference = useCookie<string>("loop_locale");
    await nuxtApp.$i18n.setLocale(preference.value === "en" ? "en" : "th");
  },
});
