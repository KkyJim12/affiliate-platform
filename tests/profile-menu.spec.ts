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
  await gotoReady(page, "/dashboard");
  const trigger = page.getByRole("button", { name: `Profile menu for ${username}`, exact: true });
  const menu = page.getByRole("menu");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("profile-wallet-address")).toHaveText(address);
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitem", { name: "Copy Polygon wallet address" })).toBeFocused();
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
  await expect(page).toHaveURL(/view=wallet/);
  await expect(menu).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/dashboard"]) {
      await gotoReady(page, path);
      await expect(trigger).toBeVisible();
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
      if (path === "/dashboard") await page.screenshot({ path: `test-results/profile-menu-${width}.png` });
      await page.keyboard.press("Escape");
    }
  }
  await trigger.click();
  await menu.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(trigger).toHaveCount(0);
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
  await gotoReady(page, "/admin/dashboard");
  const trigger = page.getByRole("button", { name: `Profile menu for ${username}`, exact: true });
  const menu = page.getByRole("menu");
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
