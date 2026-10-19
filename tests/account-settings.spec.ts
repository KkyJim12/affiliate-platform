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
function provisionAdmin(username: string) {
  execFileSync(process.execPath, ["scripts/create-admin.mjs"], { env: {
    ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, LOOP_ADMIN_USERNAME: username, LOOP_ADMIN_PASSWORD: password,
  } });
}
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
        await page.getByRole("button", { name: thai.ui.do_i_need_a_crypto_wallet_to_get_started, exact: true }).click();
        await expect(page.locator("#faq-1")).toContainText(external ? thai.connected.walletFaqAnswer : thai.ui.create_an_account_with_a_username_and_password_your_in_app_usdt_ledger_wallet_is_crea);
      }
    }
    await expect(page.getByLabel(thai.ui.username, { exact: true })).toBeVisible();
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

test("admin credentials work independently of member login settings and username changes persist", async ({ page, playwright }) => {
  test.setTimeout(60_000);
  const username = `ops_${randomUUID().slice(0, 8)}`;
  const renamed = `renamed_${randomUUID().slice(0, 8)}`;
  provisionAdmin(username);
  const guest = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await post(guest, "/api/admin/login", { username, password: "incorrect" })).status()).toBe(401);
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/admin\/login\?redirect=/);
    for (const name of ["MetaMask", "Rabby", "Phantom"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await page.getByLabel("Username", { exact: true }).fill(username.toUpperCase());
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in to admin", exact: true }).click();
    await expect(page).toHaveURL(origin + "/admin/settings");
    // The URL changes before the login page's leave transition completes.
    await expect(page.getByRole("heading", { name: "Settings", exact: true, level: 1 })).toBeVisible();
    if (external) {
      const linked = Wallet.createRandom();
      expect((await walletSignIn(page.request, linked, "link")).status()).toBe(200);
      expect((await post(guest, "/api/admin/login", { username, password })).status()).toBe(200);
      await post(guest, "/api/auth/logout", {});
      expect((await walletSignIn(guest, linked)).status()).toBe(403);
      expect((await (await guest.get("/api/auth/session")).json()).user).toBeNull();
    }
    await page.getByLabel("Username", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: "Save username", exact: true }).click();
    await expect(page.getByRole("button", { name: `Profile menu for ${renamed}`, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Username", { exact: true })).toHaveValue(renamed);
    await post(page.request, "/api/auth/logout", {});
    expect((await post(guest, "/api/admin/login", { username, password })).status()).toBe(401);
    expect((await post(guest, "/api/admin/login", { username: renamed, password })).status()).toBe(200);
  } finally { await guest.dispose(); }
});

test("members edit their own username; admins manage names with validation and access controls", async ({ page, playwright }) => {
  test.setTimeout(60_000);
  const guest = await playwright.request.newContext({ baseURL: origin });
  const admin = await playwright.request.newContext({ baseURL: origin });
  const other = await playwright.request.newContext({ baseURL: origin });
  try {
    const member = await createMember(page.request);
    const otherMember = await createMember(other);
    const renamed = `name_${randomUUID().slice(0, 8)}`;
    expect((await patch(guest, "/api/auth/profile", { username: renamed })).status()).toBe(401);
    expect((await page.request.patch("/api/auth/profile", { headers: { Origin: "https://elsewhere.example" }, data: { username: renamed } })).status()).toBe(403);
    for (const username of ["ab", "1invalid", "has space", "x".repeat(25), null])
      expect((await patch(page.request, "/api/auth/profile", { username })).status()).toBe(400);
    expect((await patch(page.request, "/api/auth/profile", { username: otherMember.username.toUpperCase() })).status()).toBe(409);
    await page.goto("/dashboard?view=settings");
    await page.getByLabel("Username", { exact: true }).fill(renamed.toUpperCase());
    await page.getByRole("button", { name: "Save username", exact: true }).click();
    await expect(page.getByRole("button", { name: `Profile menu for ${renamed}`, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Username", { exact: true })).toHaveValue(renamed);
    expect((await (await page.request.get("/api/auth/session")).json()).user).toMatchObject({ ...member, username: renamed });
    expect((await patch(page.request, `/api/admin/users/${otherMember.id}`, { username: "cannot_edit" })).status()).toBe(403);

    const adminName = `manager_${randomUUID().slice(0, 8)}`;
    provisionAdmin(adminName);
    expect((await post(admin, "/api/admin/login", { username: adminName, password })).status()).toBe(200);
    expect((await patch(admin, `/api/admin/users/${member.id}`, { username: otherMember.username })).status()).toBe(409);
    expect((await patch(admin, `/api/admin/users/${member.id}`, { username: otherMember.username, status: "suspended" })).status()).toBe(409);
    expect((await (await page.request.get("/api/auth/session")).json()).user.id).toBe(member.id);
    const managedName = `managed_${randomUUID().slice(0, 8)}`;
    await post(page.request, "/api/auth/logout", {});
    await post(page.request, "/api/admin/login", { username: adminName, password });
    await page.goto("/admin/users");
    await page.getByLabel("Search by username", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("row").filter({ hasText: `@${renamed}` }).getByRole("button", { name: "Manage", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill(managedName);
    await page.getByRole("button", { name: "Save username", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(`@${managedName}`);
    const changed = await (await admin.get(`/api/admin/users?search=${managedName}`)).json();
    expect(changed.items[0]).toMatchObject({ id: member.id, username: managedName, status: "active" });
    const overview = await (await admin.get("/api/admin/overview")).json();
    expect(overview.audit).toEqual(expect.arrayContaining([expect.objectContaining({ action: "user_username_changed" })]));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await Promise.all([guest.dispose(), admin.dispose(), other.dispose()]); }
});
