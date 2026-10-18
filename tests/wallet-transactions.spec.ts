import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { EvmTransactionHistory } from "../shared/evm-transactions";
import { openTestDatabase } from "./database";
import thai from "../i18n/locales/th.json" with { type: "json" };

const origin = "http://127.0.0.1:3100";
const password = "A wallet history test password 42!";
const other = "0x4444444444444444444444444444444444444444";
const hash = (number: number) => `0x${number.toString(16).padStart(64, "0")}`;
async function register(page: Page) {
  const response = await page.request.post("/api/auth/register", { headers: { Origin: origin }, data: { username: `hist_${randomUUID().slice(0, 8)}`, password } });
  expect(response.status()).toBe(201);
  const { user } = await response.json();
  const { wallet } = await (await page.request.get("/api/wallet/evm")).json();
  return { user, wallet };
}
function history(address: string): EvmTransactionHistory {
  return { address, chainId: 80002, limit: 50, transactions: Array.from({ length: 12 }, (_, index) => {
    const direction = index === 3 ? "self" : index === 0 || index > 4 ? "received" : "sent";
    const kind = index === 1 || index === 3 ? "erc20" : "native";
    return { id: `tx-${index}`, hash: hash(index + 1), from: direction === "received" ? other : address,
      to: direction === "received" || direction === "self" ? address : other, direction, kind,
      action: index === 4 ? "contractCall" : "transfer", status: index === 2 ? "failed" : "confirmed",
      amount: index === 1 ? "2.345678" : index === 4 ? "0" : "12.5", symbol: kind === "erc20" ? "USDT" : "POL",
      tokenAddress: kind === "erc20" ? "0x1111111111111111111111111111111111111111" : null,
      timestamp: "2026-10-19T03:00:00Z", blockNumber: String(100 - index), transactionIndex: "1",
      explorerUrl: `https://amoy.polygonscan.com/tx/${hash(index + 1)}` };
  }) };
}
async function gotoWallet(page: Page) {
  await page.goto("/dashboard?view=wallet");
  await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & { __vue_app__?: unknown })?.__vue_app__));
}
test.beforeEach(async ({ page }) => {
  const db = openTestDatabase();
  try { await db.execute("DELETE FROM rate_limits"); }
  finally { await db.close(); }
  await page.route("**/api/wallet/evm/balance", route => route.fulfill({ status: 503, json: {} }));
});

test("history API requires the owner session and distinguishes unavailable history from a missing wallet", async ({ page }) => {
  expect((await page.request.get("/api/wallet/evm/transactions")).status()).toBe(401);
  const { user } = await register(page);
  const response = await page.request.get("/api/wallet/evm/transactions?address=" + other);
  expect(response.status()).toBe(503); // Tests deliberately supply no explorer key.
  expect(response.headers()["cache-control"]).toBe("no-store");
  const failure = await response.json();
  expect(failure.statusMessage).toBe("Wallet transaction history is temporarily unavailable.");
  expect(JSON.stringify(failure)).not.toMatch(/apikey=|api\.etherscan|encrypted_keystore|privateKey/i);
  const db = openTestDatabase();
  try { await db.execute("DELETE FROM evm_wallets WHERE user_id = $1", user.id); }
  finally { await db.close(); }
  expect((await page.request.get("/api/wallet/evm/transactions")).status()).toBe(404);
});

test("wallet page lists EVM transactions below its wallet with filters, explorer links and responsive Thai layouts", async ({ page }) => {
  test.setTimeout(90_000);
  const { wallet } = await register(page);
  const data = history(wallet.address);
  await page.route("**/api/wallet/evm/transactions", route => route.fulfill({ json: data }));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await gotoWallet(page);
  const panel = page.getByTestId("wallet-transactions");
  const rows = panel.getByTestId("onchain-transaction");
  await expect(rows).toHaveCount(10);
  const position = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="evm-wallet"]')!.getBoundingClientRect();
    const transactions = document.querySelector('[data-testid="wallet-transactions"]')!.getBoundingClientRect();
    return { bottom: card.bottom, top: transactions.top };
  });
  expect(position.top).toBeGreaterThan(position.bottom);
  await expect(rows.first()).toContainText("+12.50");
  await expect(rows.nth(1)).toContainText("−2.345678");
  await expect(rows.nth(2)).toContainText("Failed");
  await expect(rows.nth(2)).not.toContainText("−12.50");
  await expect(rows.nth(3)).toContainText("Self transfer");
  await expect(rows.nth(4)).toContainText("Contract call");
  await expect(rows.nth(4)).toContainText("0.00");
  await expect(rows.nth(4)).not.toContainText("−0.00");
  await expect(rows.first().getByRole("link")).toHaveAttribute("href", data.transactions[0]!.explorerUrl);
  await expect(rows.first().getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
  await panel.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(rows).toHaveCount(12);
  await panel.getByRole("combobox", { name: "Filter transaction direction", exact: true }).click();
  await page.getByRole("listbox").locator('[data-value="sent"]').click();
  await expect(rows).toHaveCount(3);
  await panel.getByRole("searchbox").fill(hash(2));
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("USDT");
  await panel.getByRole("searchbox").fill("no_matching_hash");
  await expect(panel.getByRole("heading", { name: "No matching transactions.", exact: true })).toBeVisible();
  await panel.getByRole("searchbox").fill("");
  await panel.getByRole("combobox", { name: "Filter transaction direction", exact: true }).click();
  await page.getByRole("listbox").locator('[data-value="all"]').click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/wallet-transactions-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("listbox").locator('[data-value="th"]').click();
  await expect(panel.getByRole("heading", { name: thai.walletTransactions.title, exact: true })).toBeVisible();
  await expect(rows.first()).toContainText(thai.walletTransactions.received);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "test-results/wallet-transactions-thai-dark.png", fullPage: true });
  await page.goto("/dashboard");
  await expect(page.getByTestId("wallet-transactions")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("history loading, errors, empty results and new-wallet prompts remain distinct", async ({ page }) => {
  const { wallet } = await register(page);
  let mode = "loading";
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wallet/evm/transactions", async route => {
    if (mode === "loading") await gate;
    if (mode === "empty") return route.fulfill({ json: { address: wallet.address, chainId: 80002, transactions: [], limit: 50 } });
    return route.fulfill({ status: mode === "missing" ? 404 : 503, json: {} });
  });
  await gotoWallet(page);
  const panel = page.getByTestId("wallet-transactions");
  await expect(panel.getByRole("status")).toContainText("Loading wallet transactions");
  mode = "error";
  release();
  await expect(panel.getByRole("alert")).toContainText("Transaction history is unavailable.");
  await expect(panel).not.toContainText("No transactions yet.");
  mode = "empty";
  await panel.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "No transactions yet.", exact: true })).toBeVisible();
  mode = "missing";
  await panel.getByRole("button", { name: "Refresh wallet transactions", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Create your EVM wallet first.", exact: true })).toBeVisible();
});

test("unsigned wallet page shows a sign-in prompt instead of fabricated transactions", async ({ page }) => {
  await gotoWallet(page);
  const panel = page.getByTestId("wallet-transactions");
  await expect(panel.getByRole("heading", { name: "Your wallet activity, in one place.", exact: true })).toBeVisible();
  await expect(panel.getByTestId("onchain-transaction")).toHaveCount(0);
  await panel.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
