import { defineConfig, devices } from "@playwright/test";

const walletMode = process.env.NUXT_PUBLIC_WALLET_MODE || "embedded";
const passwordLogin = process.env.NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED ?? (walletMode === "embedded" ? "true" : "false");

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/setup.ts",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    // Existing UI scenarios explicitly exercise English/light; fresh-context tests cover defaults.
    storageState: {
      cookies: [{ name: "loop_locale", value: "en", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }],
      origins: [{ origin: "http://127.0.0.1:3100", localStorage: [{ name: "loop-color-mode", value: "light" }] }],
    },
    channel: "msedge",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node .output/server/index.mjs",
    url: "http://127.0.0.1:3100",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { PORT: "3100", HOST: "127.0.0.1", DATABASE_URL: process.env.TEST_DATABASE_URL || "", NUXT_PUBLIC_APP_URL: "http://127.0.0.1:3100", NUXT_EVM_EXPLORER_API_KEY: "", NUXT_REFERRAL_CONTRACT_ADDRESS: process.env.NUXT_REFERRAL_CONTRACT_ADDRESS || "0x1111111111111111111111111111111111111111", NUXT_REFERRAL_PAYMENT_MODE: process.env.NUXT_REFERRAL_PAYMENT_MODE || "ledger", NUXT_PUBLIC_WALLET_MODE: walletMode, NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED: passwordLogin },
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      testMatch: ["**/interface.spec.ts", "**/admin.spec.ts", "**/account-settings.spec.ts", "**/platform-workspace.spec.ts", "**/explorer.spec.ts", "**/referral.spec.ts", "**/public-tree.spec.ts", "**/onchain-referral.spec.ts", "**/onchain-wallet.spec.ts"],
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        isMobile: true,
      },
    },
  ],
});
