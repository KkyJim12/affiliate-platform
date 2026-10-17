import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/setup.ts",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "msedge",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node .output/server/index.mjs",
    url: "http://127.0.0.1:3100",
    timeout: 120_000,
    reuseExistingServer: false,
    env: { PORT: "3100", HOST: "127.0.0.1", DATABASE_URL: process.env.TEST_DATABASE_URL || "", NUXT_PUBLIC_APP_URL: "http://127.0.0.1:3100" },
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
      testMatch: ["**/interface.spec.ts", "**/admin.spec.ts", "**/explorer.spec.ts", "**/referral.spec.ts"],
      use: {
        ...devices["iPhone 13"],
        defaultBrowserType: "chromium",
        isMobile: true,
      },
    },
  ],
});
