import { createTestAdmin, memberIdFor } from "./member-fixtures";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Wallet } from "ethers";
import { purchaseShares } from "../shared/compensation";
import { openTestDatabase } from "./database";
import thai from "../i18n/locales/th.json" with { type: "json" };

const origin = "http://127.0.0.1:3100";
const hash = () => "0x" + randomBytes(32).toString("hex");
const external = process.env.NUXT_PUBLIC_WALLET_MODE === "external";
async function ready(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & { __vue_app__?: unknown })?.__vue_app__));
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}
async function records(api: APIRequestContext) {
  const database = openTestDatabase();
  const metadata = await (await api.get("/api/platform/transactions")).json();
  expect(metadata.configured, "Browser tests require a configured fixture contract.").toBe(true);
  const contract = metadata.contractAddress, token = Wallet.createRandom().address, recipient = Wallet.createRandom().address;
  const ids: string[] = [];
  for (let index = 0; index < 4; index++) {
    const id = randomUUID(); ids.push(id);
    await database.execute("INSERT INTO users VALUES ($1,$2,'unused',$3,NULL,$4)", id, `stats_${id.slice(0,8)}`, `UNASSIGNED-${id}`, new Date().toISOString());
    await database.execute("INSERT INTO wallets (id,user_id) VALUES ($1,$2)", `LW-${id}`, id);
  }
  const buyer = Wallet.createRandom().address, otherBuyer = Wallet.createRandom().address;
  async function purchase(user: string, level: number, status: string, address = contract, wallet = buyer, old = false) {
    const id = randomUUID(), transactionHash = status === "awaiting_signature" ? null : hash();
    await database.execute(`INSERT INTO referral_chain_purchases
      (id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,transaction_hash,created_at,updated_at,signing_mode)
      VALUES ($1,$2,$3,$4,$5,80002,$6,$7,$8,$9,$10,$11,$12,$13,$13,'external')`, id, user, randomUUID(), level, 10_000_000 * 2 ** (level - 1),
      address, token, wallet, recipient, JSON.stringify({ privateMarker: "PRIVATE-QUOTE-DO-NOT-RETURN" }), status, transactionHash,
      new Date(Date.now() - (old ? 120 * 86400000 : 0)).toISOString());
    if (status === "confirmed") {
      for (const [index, share] of purchaseShares(level).entries())
        await database.execute("INSERT INTO referral_chain_allocations VALUES ($1,$2,$3,$4,$5,NULL,$6,$7)", id, share.kind, share.depth, share.units, recipient, share.kind === "platform" ? "platform_fee" : "upline", index);
    }
    return transactionHash;
  }
  const paid = await purchase(ids[0]!, 1, "confirmed");
  const oldPaid = await purchase(ids[0]!, 2, "confirmed", contract, buyer.toLowerCase(), true);
  const failed = await purchase(ids[0]!, 3, "failed");
  const pending = await purchase(ids[1]!, 1, "pending", contract, otherBuyer);
  await purchase(ids[2]!, 1, "awaiting_signature");
  const otherContract = await purchase(ids[3]!, 1, "confirmed", Wallet.createRandom().address);
  const fee = hash(), externalFee = hash(), send = hash();
  const now = new Date().toISOString();
  await database.execute("INSERT INTO referral_chain_fee_updates VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8)", randomUUID(), ids[0], randomUUID(), contract, buyer, recipient, fee, now);
  for (const [kind, transactionHash] of [["fee", externalFee], ["fee", fee], ["send", send]])
    await database.execute(`INSERT INTO external_wallet_operations (id,user_id,request_key,kind,payload,transaction_hash,status,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'confirmed',$7,$7)`, randomUUID(), ids[0], randomUUID(), kind,
      JSON.stringify({ contract, call: { from: otherBuyer, to: contract, data: "0x", value: "0", chainId: 80002 }, recipient, privateMarker: "PRIVATE-OPERATION" }), transactionHash, now);
  await database.execute("INSERT INTO wallet_transactions (id,wallet_id,type,amount,status,description,request_key,created_at) VALUES ($1,$2,'deposit',999000000,'completed','PRIVATE-LEDGER-RECORD',$3,$4)", randomUUID(), `LW-${ids[0]}`, randomUUID(), now);
  return { paid, oldPaid, pending, failed, fee, externalFee, otherContract, send, buyer, contract,
    async cleanup() {
      await database.execute("DELETE FROM referral_chain_allocations WHERE purchase_id IN (SELECT id FROM referral_chain_purchases WHERE user_id = ANY($1::text[]))", ids);
      await database.execute("DELETE FROM referral_chain_purchases WHERE user_id = ANY($1::text[])", ids);
      await database.execute("DELETE FROM referral_chain_fee_updates WHERE admin_id = ANY($1::text[])", ids);
      await database.execute("DELETE FROM external_wallet_operations WHERE user_id = ANY($1::text[])", ids);
      await database.execute("DELETE FROM wallet_transactions WHERE wallet_id IN (SELECT id FROM wallets WHERE user_id = ANY($1::text[]))", ids);
      await database.execute("DELETE FROM wallets WHERE user_id = ANY($1::text[])", ids);
      await database.execute("DELETE FROM users WHERE id = ANY($1::text[])", ids);
      await database.close();
    } };
}

test("public contract APIs include platform evidence, exclude unsigned/private records, and aggregate confirmed data", async ({ request }, info) => {
  test.skip(info.project.name !== "desktop", "API coverage is shared.");
  const before = await (await request.get("/api/platform/analytics")).json();
  const initial = await (await request.get("/api/platform/transactions")).json();
  const data = await records(request);
  try {
    const response = await request.get("/api/platform/transactions");
    expect(response.status()).toBe(200);
    const activity = await response.json();
    expect(activity.total).toBe(initial.total + 6);
    expect(activity.summary.confirmed).toBe(initial.summary.confirmed + 4);
    expect(activity.summary.pending).toBe(initial.summary.pending + 1);
    expect(activity.summary.failed).toBe(initial.summary.failed + 1);
    expect(activity.summary.volume).toBeCloseTo(initial.summary.volume + 30, 6);
    const body = await response.text();
    for (const secret of ["PRIVATE-QUOTE", "PRIVATE-OPERATION", "PRIVATE-LEDGER", data.otherContract, data.send, "payload", "raw_transaction", "password_hash"])
      expect(body).not.toContain(secret);
    expect(new Set(activity.items.map((item: { hash: string }) => item.hash)).size).toBe(activity.items.length);
    const recent = await (await request.get(`/api/platform/transactions?search=${data.oldPaid}&period=7`)).json();
    expect(recent.total).toBe(0);
    expect((await (await request.get(`/api/platform/transactions?search=${data.paid?.toUpperCase()}`)).json()).total).toBe(1);
    expect((await request.get("/api/platform/transactions?kind=send")).status()).toBe(400);
    expect((await request.get("/api/platform/transactions?status=completed")).status()).toBe(400);
    const analytics = await (await request.get("/api/platform/analytics")).json();
    expect(analytics.accounts).toBe(before.accounts + 4);
    expect(analytics.activeMembers).toBe(before.activeMembers + 4);
    expect(analytics.buyers).toBe(before.buyers + 1);
    expect(analytics.purchases).toBe(before.purchases + 2);
    expect(analytics.transactions).toBe(before.transactions + 4);
    expect(analytics.volume).toBeCloseTo(before.volume + 30, 6);
    expect(analytics.distributions.direct).toBeCloseTo(before.distributions.direct + 24, 6);
    expect(analytics.distributions.bonus).toBeCloseTo(before.distributions.bonus + 4.5, 6);
    expect(analytics.distributions.platform).toBeCloseTo(before.distributions.platform + 1.5, 6);
    expect(analytics.daily).toHaveLength(30);
    expect(analytics.levels).toHaveLength(15);
    const sum = (value: { daily: { volume: number }[] }) => value.daily.reduce((total, day) => total + day.volume, 0);
    expect(sum(analytics)).toBeCloseTo(sum(before) + 10, 6);
  } finally { await data.cleanup(); }
});

test("overview shares the referral tree, FAQ has submenus, and analytics and explorer read the real APIs", async ({ page }, info) => {
  const data = await records(page.request);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "warning" && /i18n|hydration/i.test(message.text())) errors.push(message.text()); });
  try {
    await ready(page, "/dashboard");
    await expect(page.getByTestId("overview-referral-tree").locator("[data-tree-node]")).toHaveCount(9);
    await expect(page.locator('a[href*="view=matrix"]')).toHaveCount(0);
    await ready(page, "/dashboard?view=matrix");
    await expect(page).toHaveURL(origin + "/dashboard");
    await ready(page, "/faq");
    await expect(page.getByTestId("platform-faq")).toBeVisible();
    await expect(page.locator(".faq-subnav").getByRole("link", { name: "Ranks & commissions", exact: true })).toBeAttached();
    await expect(page.locator(".faq-subnav").getByRole("link", { name: "Analytics", exact: true })).toBeAttached();
    await ready(page, "/faq/analytics");
    const analytics = await (await page.request.get("/api/platform/analytics")).json();
    await expect(page.getByTestId("platform-purchases")).toHaveText(String(analytics.purchases));
    await expect(page.getByTestId("platform-volume")).toContainText(analytics.volume.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    await expect(page.locator(".analytics-chart-svg rect")).toHaveCount(30);
    await noOverflow(page);
    await page.screenshot({ path: `.data/platform-analytics-${info.project.name}.png`, fullPage: true });
    await ready(page, "/explorer");
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Search transaction hash or wallet address", { exact: true }).fill(data.paid!);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator(".explorer-table tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(data.paid!);
    await expect(page.getByRole("dialog")).toContainText(data.buyer);
    await page.keyboard.press("Escape");
    await noOverflow(page);
    await page.getByRole("combobox", { name: "Language", exact: true }).click();
    await page.getByRole("option", { name: "ไทย", exact: true }).click();
    await expect(page.getByRole("heading", { name: thai.workspace.contractTransactions, exact: true })).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: thai.ui.use_dark_theme, exact: true }).click();
    await ready(page, "/faq/analytics");
    await expect(page.getByRole("heading", { name: thai.workspace.analyticsTitle, exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `.data/platform-analytics-thai-dark-${info.project.name}.png`, fullPage: true });
    expect(errors).toEqual([]);
  } finally { await data.cleanup(); }
});

test("landing launches the app, every FAQ is Thai, and invite codes are always visible and captured on any route", async ({ page }) => {
  await page.context().addCookies([{ name: "loop_locale", value: "th", url: origin }]);
  await ready(page, "/?ref=UNXO-ABCD1234");
  await expect(page.locator(".hero-actions").getByRole("link", { name: thai.workspace.launchApp, exact: true })).toHaveAttribute("href", "/dashboard");
  await expect(page.locator(".nav-dashboard")).toHaveText(thai.workspace.launchApp);
  const questions = ["networkQuestion", "walletQuestion", "commissionsQuestion", "testnetQuestion"] as const;
  const answers = ["networkAnswer", external ? "walletAnswer" : "embeddedAnswer", "commissionsAnswer", "testnetAnswer"] as const;
  for (const [index, question] of questions.entries()) {
    const button = page.getByRole("button", { name: thai.platformFaq[question], exact: true });
    if (await button.getAttribute("aria-expanded") !== "true") await button.click();
    await expect(page.locator(`#faq-${index}`)).toHaveText(thai.platformFaq[answers[index]!]);
  }
  await ready(page, "/dashboard?ref=UNXO-ZYXW9876");
  await page.getByRole("button", { name: thai.ui.sign_in, exact: true }).first().click();
  const input = page.locator(external ? "#wallet-invite" : "#sponsor-code");
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("UNXO-ZYXW9876");
  await expect(page.locator(".wallet-invite-toggle")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await ready(page, "/faq");
  await page.getByRole("button", { name: thai.ui.sign_in, exact: true }).first().click();
  await expect(input).toHaveValue("UNXO-ZYXW9876");
  await input.fill("");
  await expect(input).toBeVisible();
  await noOverflow(page);
});

test("recent sends is styled inside the overview column and absent from the EVM wallet page", async ({ page }, info) => {
  test.skip(!external, "Connected-wallet layout regression.");
  const password = "A recent sends test password 42!";
  const memberId = createTestAdmin(password);
  const database = openTestDatabase(), wallet = Wallet.createRandom().address, recipient = Wallet.createRandom().address;
  try {
    const user = await database.one("SELECT id FROM users WHERE referral_code = $1", memberId);
    await database.execute("INSERT INTO connected_wallets (user_id,address,created_at) VALUES ($1,$2,$3)", user!.id, wallet, new Date().toISOString());
    expect((await page.request.post("/api/admin/login", { headers: { Origin: origin }, data: { memberId, password } })).status()).toBe(200);
    await page.route("**/api/wallet/evm/balance", route => route.fulfill({ json: { address: wallet, chainId: 80002, blockNumber: "1", native: { symbol: "POL", decimals: 18, balance: "1", balanceUnits: "1000000000000000000" }, token: null } }));
    await page.route("**/api/wallet/evm/transactions", route => route.fulfill({ status: 503, json: {} }));
    await page.route("**/api/wallet/connected/operations", route => route.fulfill({ json: [{ id: "test-send", kind: "send", status: "confirmed", transactionHash: "0x" + "a".repeat(64), recipient, amount: "1.234567", symbol: "POL", call: { from: wallet, to: recipient, data: "0x", value: "1", chainId: 80002 } }] }));
    await ready(page, "/dashboard");
    const recent = page.getByTestId("connected-send-history");
    await expect(recent).toBeVisible();
    await expect(page.locator(".overview-wallet-column").getByTestId("connected-send-history")).toContainText(recipient);
    await expect(recent.locator(".send-history-row")).toHaveCSS("display", "grid");
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("combobox", { name: "Language", exact: true }).click();
    await page.getByRole("listbox").locator('[data-value="th"]').click();
    await noOverflow(page);
    await page.screenshot({ path: `.data/recent-sends-overview-${info.project.name}.png`, fullPage: true });
    await ready(page, "/wallet");
    await expect(page.getByTestId("connected-wallet-panel")).toBeVisible();
    await expect(recent).toHaveCount(0);
    await noOverflow(page);
  } finally { await database.close(); }
});
