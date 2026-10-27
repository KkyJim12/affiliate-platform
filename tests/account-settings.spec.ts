import { test, expect, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { openTestDatabase } from "./database";
import thai from "../i18n/locales/th.json" with { type: "json" };

const origin = "http://127.0.0.1:3100";
const password = "An account settings test password 42!";
const external = process.env.NUXT_PUBLIC_WALLET_MODE === "external";
const post = (api: APIRequestContext, path: string, data: object) => api.post(path, { headers: { Origin: origin }, data });
const patch = (api: APIRequestContext, path: string, data: object) => api.patch(path, { headers: { Origin: origin }, data });
async function walletSignIn(api: APIRequestContext, wallet: ReturnType<typeof Wallet.createRandom>, purpose = "login") {
  const challenge = await post(api, "/api/auth/wallet/challenge", { address: wallet.address, purpose });
  expect(challenge.status()).toBe(200);
  const { id, message } = await challenge.json();
  return post(api, "/api/auth/wallet/verify", { id, signature: await wallet.signMessage(message) });
}
async function createMember(api: APIRequestContext) {
  const result = external ? await walletSignIn(api, Wallet.createRandom())
    : await post(api, "/api/auth/register", { username: `member_${randomUUID().slice(0, 8)}`, password });
  expect(result.ok()).toBe(true);
  return (await result.json()).user;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/wallet/evm/balance", route => route.fulfill({ status: 503, json: { statusMessage: "Balance unavailable in this account test." } }));
  const database = openTestDatabase();
  try { await database.execute("DELETE FROM rate_limits"); }
  finally { await database.close(); }
});

test("Thai and dark are the defaults; explicit English and light preferences persist", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ locale: "en-US", colorScheme: "light", viewport: testInfo.project.use.viewport, storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "warning" && /i18n|hydration/i.test(message.text())) errors.push(message.text()); });
    for (const path of ["/", "/dashboard?view=settings", "/admin/login"]) {
      await page.goto(origin + path);
      await expect(page.locator("html")).toHaveAttribute("lang", "th-TH");
      await expect(page.locator("html")).toHaveClass(/dark/);
      if (path === "/") {
        await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & { __vue_app__?: unknown })?.__vue_app__));
        await page.getByRole("button", { name: thai.platformFaq.walletQuestion, exact: true }).click();
        await expect(page.locator("#faq-1")).toContainText(external ? thai.platformFaq.walletAnswer : thai.platformFaq.embeddedAnswer);
      }
    }
    await expect(page.getByLabel(thai.publicTree.memberId, { exact: true })).toBeVisible();
    await expect(page.getByLabel(thai.ui.password, { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: thai.ui.language, exact: true }).click();
    await page.getByRole("option", { name: "English", exact: true }).click();
    await page.getByRole("button", { name: "Use light theme", exact: true }).click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.locator("html")).toHaveClass(/light/);
    await page.goto(origin + "/dashboard?view=settings");
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.locator("html")).toHaveClass(/light/);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test("member IDs are read-only in settings and profile writes preserve account ownership", async ({ page, playwright }) => {
  const member = await createMember(page.request);
  const guest = await playwright.request.newContext({ baseURL: origin });
  try {
    await page.goto("/dashboard?view=settings");
    await expect(page.getByTestId("account-member-id")).toHaveText(member.memberId);
    await expect(page.getByRole("textbox", { name: "Username", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save username", exact: true })).toHaveCount(0);
    expect((await patch(guest, "/api/auth/profile", { memberId: "999" })).status()).toBe(401);
    expect((await page.request.patch("/api/auth/profile", { headers: { Origin: "https://elsewhere.example" }, data: { memberId: "999" } })).status()).toBe(403);
    for (const body of [{ memberId: "999" }, { username: "renamed" }])
      expect((await patch(page.request, "/api/auth/profile", body)).status()).toBe(409);
    expect((await (await page.request.get("/api/auth/session")).json()).user).toEqual(member);
    await page.reload();
    await expect(page.getByTestId("account-member-id")).toHaveText(member.memberId);
    expect(member).not.toHaveProperty("username");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await guest.dispose(); }
});
