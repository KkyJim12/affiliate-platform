import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { hashPassword } from "../server/lib/password";
import { openTestDatabase } from "./database";
import { Wallet } from "ethers";
import { createTestAdmin } from "./member-fixtures";
import thai from "../i18n/locales/th.json" with { type: "json" };

const origin = "http://127.0.0.1:3100";
const password = "Member ID integration password 42!";
const external = process.env.NUXT_PUBLIC_WALLET_MODE === "external";
const post = (api: APIRequestContext, path: string, data: object) => api.post(path, { headers: { Origin: origin }, data });
const patch = (api: APIRequestContext, path: string, data: object) => api.patch(path, { headers: { Origin: origin }, data });

async function retainedAccount(admin = false, sponsorId: string | null = null) {
  const database = openTestDatabase(), id = randomUUID(), legacyName = `retained_${id.slice(0,8)}`;
  try {
    await database.execute("INSERT INTO users VALUES ($1,$2,$3,$4,$5,$6)", id, legacyName,
      await hashPassword(password), `UNASSIGNED-${id}`, sponsorId, new Date().toISOString());
    await database.execute("INSERT INTO wallets (id,user_id,available) VALUES ($1,$2,100000000)", `LW-${id}`, id);
    const payment = randomUUID();
    await database.execute("INSERT INTO wallet_transactions VALUES($1,$2,'referral_purchase',10000000,'completed','Historical fixture activation',$1,$3)",payment,`LW-${id}`,new Date().toISOString());
    await database.execute("INSERT INTO referral_activations(user_id,transaction_id,created_at) VALUES($1,$2,$3)",id,payment,new Date().toISOString());
    if (admin) await database.execute("INSERT INTO user_access (user_id,role) VALUES ($1,'admin')", id);
    const row = await database.one("SELECT referral_code FROM users WHERE id=$1",id);
    return { id, memberId: row!.referral_code as string, legacyName };
  } finally { await database.close(); }
}

test.beforeEach(async ({ page }) => {
  const database = openTestDatabase();
  try { await database.execute("DELETE FROM rate_limits"); }
  finally { await database.close(); }
  await page.route("**/api/wallet/evm/balance", route => route.fulfill({ status: 503, json: {} }));
  await page.route("**/api/wallet/evm/transactions", route => route.fulfill({ status: 503, json: {} }));
});

test("password registration leaves IDs blank until the first completed purchase, then member login uses the assigned ID", async ({ playwright }, info) => {
  test.skip(external || process.env.NUXT_REFERRAL_PAYMENT_MODE === 'contract' || info.project.name !== "desktop");
  const sponsor = await retainedAccount();
  const first = await playwright.request.newContext({ baseURL: origin });
  const second = await playwright.request.newContext({ baseURL: origin });
  try {
    const registered = await post(first, "/api/auth/register", { password, sponsorCode: sponsor.memberId });
    expect(registered.status()).toBe(201);
    const pending = (await registered.json()).user;
    expect(pending.memberId).toBe("");
    expect(pending.referralCode).toBeNull();
    expect(pending).not.toHaveProperty("username");
    const again = await post(second, "/api/auth/register", { password });
    expect(again.status()).toBe(201);
    expect((await again.json()).user.memberId).toBe("");
    expect((await (await first.get('/api/auth/session')).json()).user.memberId).toBe('');
    const purchase = {password,requestKey:randomUUID()};
    expect((await post(first,'/api/referrals/activate',purchase)).status()).toBe(400);
    expect((await (await first.get('/api/auth/session')).json()).user.memberId).toBe('');
    const database = openTestDatabase();
    try { await database.execute('UPDATE wallets SET available=10000000 WHERE user_id=$1',pending.id); }
    finally { await database.close(); }
    const purchased = await post(first,'/api/referrals/activate',purchase);
    expect(purchased.status(),await purchased.text()).toBe(200);
    const {user} = await purchased.json();
    expect(user.memberId).toMatch(/^[1-9][0-9]*$/);
    expect(user.referralCode).toBe(user.memberId);
    expect((await (await post(first,'/api/referrals/activate',purchase)).json()).user.memberId).toBe(user.memberId);
    expect((await (await second.get('/api/auth/session')).json()).user.memberId).toBe('');
    await post(first, "/api/auth/logout", {});
    expect((await post(first, "/api/auth/login", { username: user.memberId, password })).status()).toBe(401);
    expect((await post(first, "/api/auth/login", { memberId: user.memberId, password: "wrong" })).status()).toBe(401);
    const loggedIn = await post(first, "/api/auth/login", { memberId: user.memberId, password });
    expect(loggedIn.status()).toBe(200);
    expect((await loggedIn.json()).user).toEqual(user);
    expect(loggedIn.headers()["set-cookie"]).toContain("HttpOnly");
    expect((await patch(first, "/api/auth/profile", { memberId: "999" })).status()).toBe(409);
    expect((await (await first.get("/api/auth/session")).json()).user).toEqual(user);
  } finally { await first.dispose(); await second.dispose(); }
});

test("unpaid member settings and referral displays leave the ID blank", async ({ page }, info) => {
  test.skip(external || info.project.name !== 'desktop');
  await retainedAccount(); // Ensure this signup is not the bootstrap exception.
  const response=await post(page.request,'/api/auth/register',{password});
  expect(response.status()).toBe(201);
  expect((await response.json()).user.memberId).toBe('');
  await page.goto('/dashboard?view=settings');
  await expect(page.getByTestId('account-member-id')).toBeEmpty();
  await expect(page.locator('.account-settings-row').filter({has:page.getByTestId('account-member-id')}).getByRole('link')).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(page.getByTestId('overview-referral-tree').locator('[data-tree-node]').first()).toHaveAttribute('data-member','');
});

test("wallet signup and repeated wallet sign-in keep an unpaid Member ID blank", async ({ playwright }, info) => {
  test.skip(!external || info.project.name !== 'desktop');
  await retainedAccount();
  const api=await playwright.request.newContext({baseURL:origin}),wallet=Wallet.createRandom();
  const login=async()=>{
    const response=await post(api,'/api/auth/wallet/challenge',{address:wallet.address});
    expect(response.status()).toBe(200);
    const challenge=await response.json();
    const verified=await post(api,'/api/auth/wallet/verify',{id:challenge.id,signature:await wallet.signMessage(challenge.message)});
    expect(verified.status(),await verified.text()).toBe(200);
    return (await verified.json()).user;
  };
  try {
    const user=await login();
    expect(user.memberId).toBe('');
    expect(user.referralCode).toBeNull();
    await post(api,'/api/auth/logout',{});
    expect(await login()).toEqual(user);
  } finally { await api.dispose(); }
});

test("retained accounts keep their IDs; admin lookup, public trees and status changes expose IDs only", async ({ playwright }, info) => {
  test.skip(info.project.name !== "desktop");
  const admin = await retainedAccount(true), member = await retainedAccount(false, admin.id);
  const api = await playwright.request.newContext({ baseURL: origin });
  const guest = await playwright.request.newContext({ baseURL: origin });
  try {
    expect((await post(api, "/api/admin/login", { username: admin.legacyName, password })).status()).toBe(401);
    expect((await post(api, "/api/admin/login", { memberId: admin.memberId, password })).status()).toBe(200);
    const session = (await (await api.get("/api/auth/session")).json()).user;
    expect(session).toMatchObject({ id: admin.id, memberId: admin.memberId, role: "admin" });
    expect(session).not.toHaveProperty("username");
    const tree = await (await guest.get(`/api/referrals/tree?id=${admin.memberId}`)).json();
    expect(tree.root).toMatchObject({ id: admin.memberId, path: "", parentId: null });
    expect(tree.members[1].id).toBe(member.memberId);
    for (const value of ["username", admin.legacyName, member.legacyName, admin.id, member.id]) expect(JSON.stringify(tree)).not.toContain(value);
    const users = await (await api.get(`/api/admin/users?search=${member.memberId}`)).json();
    expect(users.items).toEqual(expect.arrayContaining([expect.objectContaining({ id: member.id, memberId: member.memberId, sponsor: admin.memberId })]));
    expect((await (await api.get(`/api/admin/users?search=${member.legacyName}`)).json()).items).toEqual([]);
    const network = await (await api.get(`/api/admin/explorer/network?memberId=${member.memberId}`)).json();
    expect(network.root.memberId).toBe(member.memberId);
    expect(network.root).not.toHaveProperty("username");
    expect((await patch(api, `/api/admin/users/${member.id}`, { memberId: "999", status: "suspended" })).status()).toBe(400);
    expect((await patch(api, `/api/admin/users/${member.id}`, { username: "renamed" })).status()).toBe(400);
    expect((await patch(api, `/api/admin/users/${member.id}`, { status: "suspended" })).status()).toBe(200);
    const overview = await (await api.get("/api/admin/overview")).json();
    expect(overview.audit).toEqual(expect.arrayContaining([expect.objectContaining({ memberId: admin.memberId, target: `ID ${member.memberId}` })]));
    expect(JSON.stringify(overview)).not.toContain(admin.legacyName);
    expect((await patch(api, `/api/admin/users/${member.id}`, { status: "active" })).status()).toBe(200);
  } finally { await api.dispose(); await guest.dispose(); }
});

test("internal transfers use recipient IDs and old descriptions render without exposing legacy names", async ({ playwright }, info) => {
  test.skip(external || info.project.name !== "desktop");
  const owner = await retainedAccount(), recipient = await retainedAccount();
  const api = await playwright.request.newContext({ baseURL: origin });
  const database = openTestDatabase();
  try {
    expect((await post(api, "/api/auth/login", { memberId: owner.memberId, password })).status()).toBe(200);
    const requestKey = randomUUID(), body = { recipient: recipient.memberId, amount: "2.5", password, requestKey };
    expect((await post(api, "/api/wallet/transfer", { ...body, recipient: recipient.legacyName })).status()).toBe(400);
    expect((await post(api, "/api/wallet/transfer", body)).status()).toBe(200);
    expect((await post(api, "/api/wallet/transfer", body)).status()).toBe(200);
    await database.execute("INSERT INTO wallet_transactions VALUES ($1,$2,'transfer_out',1000000,'completed',$3,$4,$5)", randomUUID(), `LW-${owner.id}`, `Transfer to @${recipient.legacyName}`, randomUUID(), new Date().toISOString());
    const wallet = await (await api.get("/api/wallet")).json();
    expect(wallet.available).toBe(97.5);
    expect(wallet.transactions.filter((entry: { requestKey?: string; amount: number }) => entry.amount === 2.5)).toHaveLength(1);
    expect(wallet.transactions.map((entry: { description: string }) => entry.description)).toContain(`Transfer to ID ${recipient.memberId}`);
    expect(JSON.stringify(wallet)).not.toContain(recipient.legacyName);
    const ledger = await (await api.get("/api/explorer/transactions")).json();
    expect(ledger.items[0].memberId).toBe(owner.memberId);
    expect(JSON.stringify(ledger)).not.toContain("username");
    expect(JSON.stringify(ledger)).not.toContain(recipient.legacyName);
  } finally { await api.dispose(); await database.close(); }
});

test("admin setup prints an assigned ID and lists existing admin IDs without requesting a name", async ({}, info) => {
  test.skip(info.project.name !== "desktop");
  const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, LOOP_ADMIN_PASSWORD: password };
  const memberId = await createTestAdmin(password);
  expect(memberId).toBeTruthy();
  const listed = execFileSync(process.execPath, ["scripts/create-admin.mjs", "--list"], { encoding: "utf8", env });
  expect(listed).toContain(`Administrator ID ${memberId}`);
});

test("member and admin screens identify accounts by ID and Thai pages use Level terminology", async ({ page }) => {
  const admin = await retainedAccount(true);
  await page.goto("/admin/login");
  await page.getByLabel("Member ID", { exact: true }).fill(admin.memberId);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to admin", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.goto("/admin/settings");
  await expect(page.getByTestId("account-member-id")).toHaveText(admin.memberId);
  await expect(page.getByRole("textbox", { name: /username/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /save username/i })).toHaveCount(0);
  await page.getByRole("button", { name: `Profile menu for ID ${admin.memberId}`, exact: true }).click();
  await expect(page.getByRole("menu")).toContainText(`ID ${admin.memberId}`);
  await page.keyboard.press("Escape");
  await page.goto("/dashboard?view=settings");
  await expect(page.getByTestId("account-member-id")).toHaveText(admin.memberId);
  await page.goto(`/search?id=${admin.memberId}`);
  await expect(page.locator(".public-tree-result")).toContainText(`ID ${admin.memberId}`);
  await expect(page.getByTestId("matrix-slot-card").first()).toBeVisible();
  await expect(page.locator(".public-tree-result")).not.toContainText(admin.legacyName);
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "ไทย", exact: true }).click();
  await page.goto("/faq/ranks");
  await expect(page.getByRole("heading", { name: thai.ranksPage.title, exact: true })).toBeVisible();
  await expect(page.locator("body")).toContainText("เลเวล (Level)");
  await expect(page.locator("body")).not.toContainText("ระดับ");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/member-id-thai-levels.png", fullPage: true });
});
