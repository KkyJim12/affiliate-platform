import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { openTestDatabase } from "./database";

const origin = "http://127.0.0.1:3100";
const password = "A profile menu test password 42!";

async function gotoReady(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & { __vue_app__?: unknown })?.__vue_app__));
}

test.beforeEach(async () => {
  const db = openTestDatabase();
  try { await db.execute("DELETE FROM rate_limits"); }
  finally { await db.close(); }
});

test("signed-in navbar shows the owner's wallet, supports keyboard dismissal, and logs out on desktop and mobile", async ({ page }) => {
  test.setTimeout(90_000);
  const username = `profile_${randomUUID().slice(0, 8)}`;
  const registration = await page.request.post("/api/auth/register", { headers: { Origin: origin }, data: { username, password } });
  expect(registration.status()).toBe(201);
  const address = (await (await page.request.get("/api/wallet/evm")).json()).wallet.address;
  let balanceReads = 0;
  await page.route("**/api/wallet/evm/balance", route => {
    balanceReads++;
    return route.fulfill({ json: { address, chainId: 80002, blockNumber: "100",
      native: { symbol: "POL", decimals: 18, balance: "0.5", balanceUnits: "500000000000000000" },
      token: { address: "0x1111111111111111111111111111111111111111", symbol: "USDT", decimals: 6, balance: "1234.567891", balanceUnits: "1234567891" } } });
  });
  await gotoReady(page, "/dashboard");
  const trigger = page.getByRole("button", { name: `Profile menu for ${username}`, exact: true });
  const menu = page.getByRole("menu");
  await expect(trigger.getByTestId("profile-usdt-balance")).toContainText("1,234.57");
  await expect(trigger.getByTestId("profile-usdt-balance")).toContainText("USDT");
  await expect(page.locator(".dashboard-topbar .topbar-wallet")).toHaveCount(0);
  expect(balanceReads).toBe(1);
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("profile-wallet-address")).toHaveText(address);
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitem", { name: "Copy EVM wallet address" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Sign out", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Account settings", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("heading", { name: "Your network, at a glance." }).click();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await menu.getByRole("menuitem", { name: "My wallet", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/wallet`);
  await expect(menu).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/dashboard"]) {
      await gotoReady(page, path);
      await expect(trigger).toBeVisible();
      await expect(trigger.getByTestId("profile-usdt-balance")).toContainText("1,234.57");
      await trigger.click();
      await expect(menu.getByTestId("profile-wallet-address")).toHaveText(address);
      const bounds = await menu.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(11);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 11);
      const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        overflowing: Array.from(document.querySelectorAll("header, header > *, header .nav-actions > *"))
          .filter(element => element.getBoundingClientRect().right > innerWidth)
          .map(element => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })) }));
      expect(layout.scrollWidth, `${path} at ${width}px: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(width);
      expect(layout.overflowing, `${path} at ${width}px: navbar controls must remain visible`).toEqual([]);
      if (path === "/dashboard") await page.screenshot({ path: `test-results/profile-menu-${width}.png` });
      await page.keyboard.press("Escape");
    }
  }
  await trigger.click();
  await menu.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(trigger).toHaveCount(0);
  await expect(page.getByTestId("profile-usdt-balance")).toHaveCount(0);
  expect((await page.request.get("/api/wallet/evm")).status()).toBe(401);
});

test("administrator profile menu links to admin settings and signs out to admin login", async ({ page }) => {
  const username = `profile_ops_${randomUUID().slice(0, 8)}`;
  execFileSync(process.execPath, ["scripts/create-admin.mjs"], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, LOOP_ADMIN_USERNAME: username, LOOP_ADMIN_PASSWORD: password },
    stdio: "pipe",
  });
  const login = await page.request.post("/api/admin/login", { headers: { Origin: origin }, data: { username, password } });
  expect(login.status()).toBe(200);
  const address = (await (await page.request.get("/api/wallet/evm")).json()).wallet.address;
  await page.route("**/api/wallet/evm/balance", route => route.fulfill({ json: { address, chainId: 80002, blockNumber: "100",
    native: { symbol: "POL", decimals: 18, balance: "0.5", balanceUnits: "500000000000000000" }, token: null } }));
  await gotoReady(page, "/admin/dashboard");
  const trigger = page.getByRole("button", { name: `Profile menu for ${username}`, exact: true });
  const menu = page.getByRole("menu");
  await expect(trigger.getByTestId("profile-usdt-balance")).toContainText("—");
  await trigger.click();
  await expect(menu.getByTestId("profile-wallet-address")).toHaveText(address);
  await menu.getByRole("menuitem", { name: "Account settings", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await menu.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await page.request.get("/api/admin/overview")).status()).toBe(401);
});

test("profile USDT balance follows wallet refreshes and handles missing tokens and RPC errors", async ({ page }) => {
  const username = `usd_${randomUUID().slice(0, 8)}`;
  expect((await page.request.post("/api/auth/register", { headers: { Origin: origin }, data: { username, password } })).status()).toBe(201);
  const address = (await (await page.request.get("/api/wallet/evm")).json()).wallet.address;
  let mode = "usdt";
  await page.route("**/api/wallet/evm/balance", route => mode === "error"
    ? route.fulfill({ status: 503, json: {} })
    : route.fulfill({ json: { address, chainId: 80002, blockNumber: "100",
      native: { symbol: "POL", decimals: 18, balance: "0.5", balanceUnits: "500000000000000000" },
      token: mode === "native" ? null : { address: "0x1111111111111111111111111111111111111111", symbol: mode === "other" ? "USDC" : mode === "test" ? "tUSDT" : "USDT", decimals: 6,
        balance: mode === "zero" ? "0" : "12.345678", balanceUnits: mode === "zero" ? "0" : "12345678" } } }));
  await gotoReady(page, "/dashboard?view=wallet");
  const balance = page.getByTestId("profile-usdt-balance");
  const refresh = page.getByRole("button", { name: "Refresh on-chain balance", exact: true });
  await expect(balance).toContainText("12.35");
  for (const [nextMode, expected] of [["test", "12.35"], ["zero", "0.00"], ["native", "—"], ["other", "—"], ["error", "—"], ["usdt", "12.35"]]) {
    mode = nextMode!;
    await refresh.click();
    await expect(refresh).toBeEnabled();
    await expect(balance).toContainText(expected!);
    await expect(balance.locator("small")).toHaveText(mode === "test" ? "tUSDT" : "USDT");
    if (["native", "other", "error"].includes(mode)) await expect(balance).toHaveAttribute("title", "USDT balance unavailable");
  }
});
