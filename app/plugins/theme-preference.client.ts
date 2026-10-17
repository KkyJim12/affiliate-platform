export default defineNuxtPlugin({
  name: "theme-preference",
  enforce: "post",
  setup(nuxtApp) {
    nuxtApp.hook("app:mounted", () => {
      const colorMode = useColorMode();
      // Keep the current appearance when migrating a saved system preference.
      if (colorMode.preference !== "light" && colorMode.preference !== "dark") {
        colorMode.preference = colorMode.value === "dark" ? "dark" : "light";
      }
    });
  },
});
