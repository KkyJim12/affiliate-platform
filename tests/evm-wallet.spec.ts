import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Wallet, computeAddress } from "ethers";
import { openTestDatabase } from "./database";
import { hashPassword } from "../server/lib/password";

const origin = "http://127.0.0.1:3100";
const password = "An isolated test wallet password 42!";
const post = (api: APIRequestContext, path: string, body: object) => api.post(path, { headers: { Origin: origin }, data: body });

test.beforeEach(async () => {
  const db = openTestDatabase();
  try { await db.execute("DELETE FROM rate_limits"); }
  finally { await db.close(); }
});

test("registration provisions an encrypted Amoy wallet; only its owner can unlock it", async ({ playwright }) => {
  test.setTimeout(90_000);
  const owner = await playwright.request.newContext({ baseURL: origin });
  const other = await playwright.request.newContext({ baseURL: origin });
  const guest = await playwright.request.newContext({ baseURL: origin });
  const db = openTestDatabase();
  const username = `evm_${randomUUID().slice(0, 8)}`;
  try {
    const registration = await post(owner, "/api/auth/register", { username, password });
    expect(registration.status()).toBe(201);
    const user = (await registration.json()).user;
    const detailsResponse = await owner.get("/api/wallet/evm");
    expect(detailsResponse.headers()["cache-control"]).toBe("no-store");
    const details = (await detailsResponse.json()).wallet;
    expect(details).toMatchObject({ chainId: 80002, network: "Polygon Amoy", testnet: true, currency: "POL" });
    expect(computeAddress(details.publicKey)).toBe(details.address);
    expect(details.privateKey).toBeUndefined();
    expect(details.encrypted_keystore).toBeUndefined();
    const stored = await db.one("SELECT * FROM evm_wallets WHERE user_id = $1", user.id);
    const decrypted = await Wallet.fromEncryptedJson(stored!.encrypted_keystore, password);
    expect(decrypted.address).toBe(details.address);
    expect(stored!.encrypted_keystore.includes(decrypted.privateKey)).toBe(false);
    expect((await guest.get("/api/wallet/evm")).status()).toBe(401);
    expect((await post(guest, "/api/wallet/evm/reveal", { password })).status()).toBe(401);
    expect((await owner.post("/api/wallet/evm/reveal", { data: { password } })).status()).toBe(403);
    expect((await owner.post("/api/wallet/evm/reveal", { headers: { Origin: "https://unrelated.example" }, data: { password } })).status()).toBe(403);
    expect((await post(owner, "/api/wallet/evm/reveal", { password: "Incorrect password!" })).status()).toBe(401);
    const reveal = await post(owner, "/api/wallet/evm/reveal", { password, userId: "ignored" });
    expect(reveal.headers()["cache-control"]).toBe("no-store");
    expect(computeAddress((await reveal.json()).privateKey)).toBe(details.address);
    expect((await post(owner, "/api/wallet/evm", { password })).status()).toBe(200);
    expect((await db.one("SELECT address FROM evm_wallets WHERE user_id = $1", user.id))!.address).toBe(details.address);
    expect((await post(other, "/api/auth/register", { username: `evb_${randomUUID().slice(0, 8)}`, password })).status()).toBe(201);
    const otherWallet = (await (await other.get(`/api/wallet/evm?userId=${user.id}`)).json()).wallet;
    expect(otherWallet.address).not.toBe(details.address);
    const otherKey = await post(other, "/api/wallet/evm/reveal", { password, userId: user.id });
    expect(computeAddress((await otherKey.json()).privateKey)).toBe(otherWallet.address);
    await post(owner, "/api/auth/logout", {});
    expect((await post(owner, "/api/auth/login", { username, password })).status()).toBe(200);
    expect((await (await owner.get("/api/wallet/evm")).json()).wallet.address).toBe(details.address);
    for (let i = 0; i < 3; i++) await post(owner, "/api/wallet/evm/reveal", { password: "Incorrect password!" });
    expect((await post(owner, "/api/wallet/evm/reveal", { password })).status()).toBe(429);
    await db.execute("INSERT INTO user_access (user_id, status) VALUES ($1, 'suspended')", user.id);
    expect((await post(owner, "/api/wallet/evm/reveal", { password })).status()).toBe(401);
  } finally { await Promise.all([owner.dispose(), other.dispose(), guest.dispose(), db.close()]); }
});

test("concurrent first logins provision exactly one wallet for a legacy account", async ({ playwright }) => {
  test.setTimeout(90_000);
  const db = openTestDatabase();
  const first = await playwright.request.newContext({ baseURL: origin });
  const second = await playwright.request.newContext({ baseURL: origin });
  const id = randomUUID(), username = `legacy_${randomUUID().slice(0, 8)}`;
  try {
    await db.execute("INSERT INTO users VALUES ($1, $2, $3, $4, NULL, $5)", id, username, await hashPassword(password), `UNASSIGNED-${id}`, new Date().toISOString());
    await db.execute("INSERT INTO wallets (id, user_id) VALUES ($1, $2)", `LW-${randomUUID()}`, id);
    const results = await Promise.all([post(first, "/api/auth/login", { username, password }), post(second, "/api/auth/login", { username, password })]);
    expect(results.map(result => result.status())).toEqual([200, 200]);
    const a = (await (await first.get("/api/wallet/evm")).json()).wallet;
    const b = (await (await second.get("/api/wallet/evm")).json()).wallet;
    expect(a.address).toBe(b.address);
    expect((await db.one("SELECT COUNT(*) AS count FROM evm_wallets WHERE user_id = $1", id))!.count).toBe(1);
  } finally { await Promise.all([db.close(), first.dispose(), second.dispose()]); }
});

test("wallet UI reveals keys after a password check and clears them on close, timeout and navigation", async ({ page }) => {
  test.setTimeout(90_000);
  const registration = await post(page.request, "/api/auth/register", { username: `evui_${randomUUID().slice(0, 8)}`, password });
  expect(registration.status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard?view=wallet");
  const card = page.getByTestId("evm-wallet");
  await expect(card).toContainText("Polygon Amoy");
  await expect(card).toContainText("80002");
  await expect(card.getByTestId("evm-address")).toHaveText(/^0x[0-9a-fA-F]{40}$/);
  await expect(page.getByTestId("evm-private-key")).toHaveCount(0);
  await card.getByRole("button", { name: "Reveal private key" }).click();
  await page.getByLabel("Confirm with your password", { exact: true }).fill("Incorrect password!");
  await page.getByRole("dialog").getByRole("button", { name: "Reveal private key", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your password is incorrect.");
  await page.getByLabel("Confirm with your password", { exact: true }).fill(password);
  await page.getByRole("dialog").getByRole("button", { name: "Reveal private key", exact: true }).click();
  await expect(page.getByTestId("evm-private-key")).toHaveValue(/^0x[a-f0-9]{64}$/i);
  await page.getByRole("button", { name: "Hide private key", exact: true }).click();
  expect(await page.getByTestId("evm-private-key").evaluateAll(elements => elements.every(element => !(element as HTMLTextAreaElement).value))).toBe(true);
  await expect(page.getByTestId("evm-private-key")).toHaveCount(0);
  await card.getByRole("button", { name: "Reveal private key" }).click();
  await expect(page.getByTestId("evm-private-key")).toHaveCount(0);
  await page.getByLabel("Confirm with your password", { exact: true }).fill(password);
  await page.clock.install();
  await page.getByRole("dialog").getByRole("button", { name: "Reveal private key", exact: true }).click();
  await expect(page.getByTestId("evm-private-key")).toBeVisible();
  await page.clock.fastForward(31_000);
  await expect(page.getByTestId("evm-private-key")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.clock.resume();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/evm-wallet-mobile.png", fullPage: true });
  await card.getByRole("button", { name: "Reveal private key" }).click();
  await page.getByLabel("Confirm with your password", { exact: true }).fill(password);
  await page.getByRole("dialog").getByRole("button", { name: "Reveal private key", exact: true }).click();
  await expect(page.getByTestId("evm-private-key")).toBeVisible();
  await page.goto("/dashboard?view=overview");
  await expect(page.getByTestId("evm-private-key")).toHaveCount(0);
});
