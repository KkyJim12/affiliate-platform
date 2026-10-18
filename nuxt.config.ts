import { fileURLToPath } from "node:url";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ["@nuxtjs/tailwindcss", "nuxt-toast", "@nuxtjs/color-mode", "@nuxtjs/i18n"],
  nitro: {
    esbuild: { options: { target: "es2022" } },
    serverAssets: [{ baseName: "migrations", dir: fileURLToPath(new URL("./database/migrations/", import.meta.url)), pattern: "*.sql" }],
  },
  postcss: { plugins: { "tailwindcss/nesting": false } },
  css: [
    "@fontsource-variable/dm-sans",
    "@fontsource-variable/manrope",
    "@fontsource-variable/noto-sans-thai",
    "~/assets/css/main.css",
    "~/assets/css/matrix.css",
    "~/assets/css/theme.css",
    "~/assets/css/admin.css",
    "~/assets/css/explorer.css",
    "~/assets/css/referral.css",
    "~/assets/css/motion.css",
  ],
  colorMode: {
    preference: "light",
    fallback: "light",
    classSuffix: "",
    storageKey: "loop-color-mode",
    dataValue: "theme",
    disableTransition: true,
  },
  i18n: {
    strategy: "no_prefix",
    defaultLocale: "en",
    langDir: "locales",
    vueI18n: "./i18n.config.ts",
    locales: [
      { code: "en", language: "en-US", name: "English", file: "en.json" },
      { code: "th", language: "th-TH", name: "ไทย", file: "th.json" },
    ],
    detectBrowserLanguage: { useCookie: true, cookieKey: "loop_locale", redirectOn: "root", fallbackLocale: "en" },
  },
  runtimeConfig: {
    evm: { rpcUrl: "", chainId: "", tokenAddress: "", treasuryAddress: "", minConfirmations: "", explorerApiKey: "" },
    public: { appUrl: "" },
  },
  app: {
    pageTransition: { name: "page", mode: "out-in" },
    head: {
      title: "UNXO",
      meta: [
        {
          name: "description",
          content:
            "Your three-layer binary matrix, 15 referral levels, and EVM wallet. Sign in with your username and password.",
        },
      ],
      link: [{ rel: "icon", type: "image/jpeg", href: "/logo.jpg" }],
    },
  },
  compatibilityDate: "2025-07-15",
  debug: false,
  devtools: { enabled: false },
});
