import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import thai from "../i18n/locales/th.json" with { type: "json" };

const origin = "http://127.0.0.1:3100";
const password = "An admin integration password 42!";
const post = (api: APIRequestContext, path: string, data: object) => api.post(path, { headers: { Origin: origin }, data });

function provisionAdmin(username: string) {
  const output = execFileSync(process.execPath, ["scripts/create-admin.mjs"], {
    cwd: resolve("."), encoding: "utf8",
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, LOOP_ADMIN_USERNAME: username, LOOP_ADMIN_PASSWORD: password, NODE_NO_WARNINGS: "1" },
  });
  expect(output).toContain(`Administrator @${username} created`);
  expect(output).not.toContain(password);
}

async function navigate(page: Page, label: string) {
  const toggle = page.getByRole("button", { name: "Open admin navigation", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("navigation", { name: "Admin navigation" }).getByRole("link", { name: label, exact: true }).click();
}

async function gotoReady(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & { __vue_app__?: unknown })?.__vue_app__));
}

test("admin authorization, settlement idempotency, rejection, suspension, and persisted controls", async ({ playwright }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "API coverage is shared between desktop and mobile.");
  const suffix = Date.now().toString(36);
  const adminName = `ops_${suffix}`;
  provisionAdmin(adminName);
  const admin = await playwright.request.newContext({ baseURL: origin });
  const member = await playwright.request.newContext({ baseURL: origin });
  const guest = await playwright.request.newContext({ baseURL: origin });
  let original: Record<string, unknown> | undefined;
  try {
    for (const path of ["overview", "users", "payments", "settings"]) expect((await guest.get(`/api/admin/${path}`)).status()).toBe(401);
    const memberName = `member_${suffix}`;
    const registered = await post(member, "/api/auth/register", { username: memberName, password, role: "admin" });
    expect(registered.status()).toBe(201);
    const user = (await registered.json()).user;
    expect(user.role).toBe("member");
    for (const path of ["overview", "users", "payments", "settings"]) expect((await member.get(`/api/admin/${path}`)).status()).toBe(403);
    expect((await post(member, "/api/admin/login", { username: memberName, password })).status()).toBe(401);
    expect((await post(admin, "/api/admin/login", { username: adminName, password: "incorrect" })).status()).toBe(401);
    const signedIn = await post(admin, "/api/admin/login", { username: adminName.toUpperCase(), password });
    expect(signedIn.status()).toBe(200);
    expect((await signedIn.json()).user.role).toBe("admin");
    expect(signedIn.headers()["set-cookie"]).toContain("HttpOnly");
    original = await (await admin.get("/api/admin/settings")).json();
    const payments: string[] = [];
    for (const amount of ["12.345678", "20", "5"]) {
      const funding = await post(member, "/api/wallet/deposit", { amount, requestKey: randomUUID() });
      expect(funding.status()).toBe(200);
      payments.push((await funding.json()).transactions.find((item: { amount: number }) => item.amount === Number(amount)).id);
    }
    const review = { decision: "approved", reference: `settled-${suffix}`, note: "Verified in test settlement", verified: true };
    expect((await post(member, `/api/admin/payments/${payments[0]}`, review)).status()).toBe(403);
    expect((await post(admin, `/api/admin/payments/${payments[0]}`, { ...review, verified: false })).status()).toBe(400);
    expect((await admin.post(`/api/admin/payments/${payments[0]}`, { headers: { Origin: "https://elsewhere.example" }, data: review })).status()).toBe(403);
    const approvals = await Promise.all([1, 2].map(() => post(admin, `/api/admin/payments/${payments[0]}`, review)));
    expect(approvals.map(response => response.status())).toEqual([200, 200]);
    expect((await (await member.get("/api/wallet")).json()).available).toBe(12.345678);
    expect((await post(admin, `/api/admin/payments/${payments[1]}`, { ...review, reference: review.reference.toUpperCase() })).status()).toBe(409);
    expect((await post(admin, `/api/admin/payments/${payments[1]}`, { decision: "rejected", note: "Receipt could not be verified" })).status()).toBe(200);
    expect((await post(admin, `/api/admin/payments/${payments[1]}`, review)).status()).toBe(409);
    const wallet = await (await member.get("/api/wallet")).json();
    expect(wallet.available).toBe(12.345678);
    expect(wallet.transactions.find((item: { id: string }) => item.id === payments[1]).status).toBe("rejected");
    const rejected = await (await admin.get(`/api/admin/payments?search=${memberName}&status=rejected`)).json();
    expect(rejected.total).toBe(1);
    expect(rejected.items[0]).toMatchObject({ id: payments[1], reviewedBy: adminName, status: "rejected" });
    const users = await (await admin.get(`/api/admin/users?search=${memberName}`)).json();
    expect(users.items).toHaveLength(1);
    expect(users.items[0]).toMatchObject({ balance: 12.345678, role: "member", status: "active" });
    expect(JSON.stringify(users)).not.toContain("password_hash");
    const setStatus = (status: string) => admin.patch(`/api/admin/users/${user.id}`, { headers: { Origin: origin }, data: { status } });
    expect((await member.patch(`/api/admin/users/${user.id}`, { headers: { Origin: origin }, data: { status: "suspended" } })).status()).toBe(403);
    expect((await setStatus("suspended")).status()).toBe(200);
    expect((await member.get("/api/wallet")).status()).toBe(401);
    expect((await post(member, "/api/auth/login", { username: memberName, password })).status()).toBe(401);
    expect((await setStatus("active")).status()).toBe(200);
    expect((await post(member, "/api/auth/login", { username: memberName, password })).status()).toBe(200);
    const adminId = (await (await admin.get(`/api/admin/users?search=${adminName}`)).json()).items[0].id;
    expect((await admin.patch(`/api/admin/users/${adminId}`, { headers: { Origin: origin }, data: { status: "suspended" } })).status()).toBe(403);
    const controls = { registrationOpen: false, fundingOpen: false, supportEmail: "support@example.com" };
    expect((await member.put("/api/admin/settings", { headers: { Origin: origin }, data: controls })).status()).toBe(403);
    expect((await admin.put("/api/admin/settings", { headers: { Origin: origin }, data: { ...controls, supportEmail: "not-an-email" } })).status()).toBe(400);
    expect((await admin.put("/api/admin/settings", { headers: { Origin: origin }, data: controls })).status()).toBe(200);
    expect(await (await guest.get("/api/platform-settings")).json()).toEqual({ ...controls, feeRecipientAddress: original!.feeRecipientAddress });
    expect((await post(guest, "/api/auth/register", { username: `closed_${suffix}`, password })).status()).toBe(403);
    expect((await post(member, "/api/wallet/deposit", { amount: "1", requestKey: randomUUID() })).status()).toBe(403);
    const overview = await (await admin.get("/api/admin/overview")).json();
    expect(overview.growth).toHaveLength(7);
    expect(overview.audit.map((item: { action: string }) => item.action)).toEqual(expect.arrayContaining(["settings_updated", "payment_approved", "payment_rejected", "user_suspended", "user_activated"]));
    expect((await admin.get("/api/admin/users?page=2")).status()).toBe(200);
  } finally {
    if (original) await admin.put("/api/admin/settings", { headers: { Origin: origin }, data: original });
    await Promise.all([admin.dispose(), member.dispose(), guest.dispose()]);
  }
});

test("admin login and all management pages work in English, Thai, light and dark", async ({ page, playwright }, testInfo) => {
  test.setTimeout(60000);
  const suffix = Date.now().toString(36);
  const adminName = `uiops_${suffix}`;
  const memberName = `uimember_${suffix}`;
  const supportEmail = `help+${suffix}@example.com`;
  provisionAdmin(adminName);
  const member = await playwright.request.newContext({ baseURL: origin });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "warning" && /i18n|hydration/i.test(message.text())) errors.push(message.text()); });
  let original: Record<string, unknown> | undefined;
  try {
    expect((await post(member, "/api/auth/register", { username: memberName, password })).status()).toBe(201);
    expect((await post(member, "/api/wallet/deposit", { amount: "42.123456", requestKey: randomUUID() })).status()).toBe(200);
    await gotoReady(page, "/admin/users");
    await expect(page).toHaveURL(/\/admin\/login\?redirect=/);
    await expect(page.getByRole("heading", { name: "Admin login", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/admin-login-${testInfo.project.name}.png`, fullPage: true, animations: "disabled" });
    await page.getByLabel("Username", { exact: true }).fill(adminName);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in to admin", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/admin/users`);
    const settingsResponse = await page.request.get("/api/admin/settings");
    expect(settingsResponse.ok()).toBe(true);
    original = await settingsResponse.json();
    await page.getByRole("textbox", { name: "Search by username", exact: true }).fill(memberName);
    await page.getByRole("textbox", { name: "Search by username", exact: true }).press("Enter");
    const row = page.getByRole("row").filter({ hasText: `@${memberName}` });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "Manage", exact: true }).click();
    await page.getByRole("button", { name: "Suspend member", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row).toContainText("Suspended");
    await row.getByRole("button", { name: "Manage", exact: true }).click();
    await page.getByRole("button", { name: "Reactivate member", exact: true }).click();
    await expect(row).toContainText("Active");
    await post(member, "/api/auth/login", { username: memberName, password });
    await navigate(page, "Dashboard");
    await expect(page.getByRole("heading", { name: "The bigger picture.", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/admin-dashboard-${testInfo.project.name}.png`, fullPage: true, animations: "disabled" });
    await navigate(page, "Payments");
    await page.getByRole("textbox", { name: "Search member or reference", exact: true }).fill(memberName);
    await page.getByRole("textbox", { name: "Search member or reference", exact: true }).press("Enter");
    await page.getByRole("row").filter({ hasText: `@${memberName}` }).getByRole("button", { name: "Review", exact: true }).click();
    await page.getByLabel("Settlement reference", { exact: true }).fill(`ui-settlement-${suffix}`);
    await page.getByLabel("I have verified receipt of this payment.", { exact: true }).check();
    await page.getByRole("button", { name: "Approve and credit wallet", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: `@${memberName}` })).toContainText("Completed");
    expect((await (await member.get("/api/wallet")).json()).available).toBe(42.123456);
    await navigate(page, "Settings");
    await page.getByLabel("Support email", { exact: true }).fill(supportEmail);
    await page.getByLabel("Platform fee address", { exact: true }).fill("0x3434343434343434343434343434343434343434");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save changes", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.getByRole("combobox", { name: "Language", exact: true }).first().click();
    await page.getByRole("listbox").locator('[role="option"][data-value="th"]').click();
    await expect(page.getByRole("heading", { level: 1, name: thai.admin.settings, exact: true })).toBeVisible();
    await page.reload();
    await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & { __vue_app__?: unknown })?.__vue_app__));
    await expect(page.getByLabel(thai.admin.supportEmail, { exact: true })).toHaveValue(supportEmail);
    await expect(page.getByLabel(thai.admin.feeRecipientAddress, { exact: true })).toHaveValue("0x3434343434343434343434343434343434343434");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("select, option")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/admin-settings-thai-dark-${testInfo.project.name}.png`, fullPage: true, animations: "disabled" });
    await gotoReady(page, "/dashboard");
    await expect(page.locator(`a[href="mailto:${supportEmail}"]`)).toBeVisible();
    expect((await page.request.put("/api/admin/settings", { headers: { Origin: origin }, data: original })).ok()).toBe(true);
    await gotoReady(page, "/admin/dashboard");
    const toggle = page.getByRole("button", { name: thai.admin.openNavigation, exact: true });
    if (await toggle.isVisible()) await toggle.click();
    await page.getByRole("button", { name: thai.ui.sign_out, exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await gotoReady(page, "/admin/settings");
    await expect(page).toHaveURL(/\/admin\/login/);
    expect(errors).toEqual([]);
  } finally {
    if (original) {
      await post(page.request, "/api/admin/login", { username: adminName, password });
      await page.request.put("/api/admin/settings", { headers: { Origin: origin }, data: original });
    }
    await member.dispose();
  }
});
