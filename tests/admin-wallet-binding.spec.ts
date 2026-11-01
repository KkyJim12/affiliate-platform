import { test, expect } from "@playwright/test";
import { Wallet, getBytes } from "ethers";
import { createTestAdmin } from "./member-fixtures";
import { openTestDatabase } from "./database";

test.skip(process.env.NUXT_PUBLIC_WALLET_MODE !== "external", "Requires external wallet mode.");
const origin = "http://127.0.0.1:3100";
const password = "Permanent admin wallet password 42!";

test("admin Settings permanently binds a signed wallet to ID 1 and rejects wallet switches", async ({ page, playwright }) => {
  test.setTimeout(60000);
  const database = openTestDatabase();
  const wallet = Wallet.createRandom(), other = Wallet.createRandom();
  try {
    // Run against a fresh disposable database so ID 1 has no previous binding.
    const memberId = await createTestAdmin(password);
    expect(memberId).toBe("1");
    const root = (await database.one("SELECT id FROM users WHERE referral_code='1'"))!;
    await page.exposeFunction("adminWalletRequest", async (method: string, params: string[]) => {
      if (method === "personal_sign") return (params[1].toLowerCase() === other.address.toLowerCase() ? other : wallet).signMessage(getBytes(params[0]));
      throw Error(`Unexpected wallet request: ${method}`);
    });
    await page.addInitScript(() => {
      const browser = window as any;
      browser.adminWalletListeners = {};
      browser.adminSignatureCount = 0;
      browser.ethereum = {
        isMetaMask: true,
        request: async ({ method, params = [] }: { method: string; params?: string[] }) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts") return [browser.adminSelectedWallet];
          if (method === "eth_chainId") return "0x13882";
          if (method === "personal_sign") {
            browser.adminSignatureCount++;
            if (browser.rejectAdminSignature) throw Object.assign(new Error("User rejected request"), { code: 4001 });
          }
          return browser.adminWalletRequest(method, params);
        },
        on: (event: string, listener: Function) => { (browser.adminWalletListeners[event] ||= []).push(listener); },
        removeListener: (event: string, listener: Function) => {
          browser.adminWalletListeners[event] = (browser.adminWalletListeners[event] || []).filter((item: Function) => item !== listener);
        },
      };
    });
    await page.addInitScript(address => { (window as any).adminSelectedWallet = address; }, wallet.address);
    expect((await page.request.post("/api/admin/login", { headers: { Origin: origin }, data: { memberId, password } })).status()).toBe(200);
    // Obtain a second valid challenge before binding to verify the verification
    // endpoint also rejects a stale attempt to replace the winning wallet.
    const stale = await (await page.request.post("/api/auth/wallet/challenge", { headers: { Origin: origin }, data: { address: other.address, purpose: "link" } })).json();
    expect((await page.request.post("/api/auth/wallet/verify", { headers: { Origin: origin }, data: { id: stale.id, signature: await wallet.signMessage(stale.message) } })).status()).toBe(401);
    expect(await database.one("SELECT address FROM connected_wallets WHERE user_id=$1", root.id)).toBeUndefined();
    await page.goto("/admin/settings");
    const panel = page.getByTestId("admin-wallet-binding");
    await expect(panel).toContainText("cannot be replaced or removed");
    await panel.getByRole("button", { name: "MetaMask", exact: true }).click();
    await expect(page.getByTestId("admin-bound-wallet")).toHaveText(wallet.address);
    const session = async () => (await (await page.request.get("/api/auth/session")).json()).user;
    expect(await session()).toMatchObject({ id: root.id, memberId: "1", role: "admin" });
    expect((await database.one("SELECT COUNT(*) AS count FROM users"))!.count).toBe(1);
    expect((await database.one("SELECT address FROM connected_wallets WHERE user_id=$1", root.id))!.address).toBe(wallet.address);
    const replacement = await page.request.post("/api/auth/wallet/challenge", { headers: { Origin: origin }, data: { address: other.address, purpose: "link" } });
    expect(replacement.status()).toBe(409);
    const staleResponse = await page.request.post("/api/auth/wallet/verify", { headers: { Origin: origin }, data: { id: stale.id, signature: await other.signMessage(stale.message) } });
    expect(staleResponse.status()).toBe(409);
    const signatures = await page.evaluate(() => (window as any).adminSignatureCount);
    await page.evaluate(address => {
      const browser = window as any;
      browser.adminSelectedWallet = address;
      [...browser.adminWalletListeners.accountsChanged].forEach((listener: Function) => listener([address]));
    }, other.address);
    await expect(panel.getByRole("alert")).toContainText("permanently bound to ID 1");
    expect(await session()).toMatchObject({ id: root.id, memberId: "1", role: "admin" });
    await panel.getByRole("button", { name: "MetaMask", exact: true }).click();
    expect(await page.evaluate(() => (window as any).adminSignatureCount)).toBe(signatures);
    await expect(page.getByTestId("admin-bound-wallet")).toHaveText(wallet.address);
    await page.reload();
    await expect(page.getByTestId("admin-bound-wallet")).toHaveText(wallet.address);
    // The bound wallet restores the same administrator account through either
    // login entry point, while credentials continue to work after linking.
    const logout = () => page.request.post("/api/auth/logout", { headers: { Origin: origin } });
    await logout();
    await page.goto("/admin/login?redirect=/admin/settings");
    await expect(page.getByLabel("Member ID", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await page.evaluate(() => { (window as any).rejectAdminSignature = true; });
    await page.getByRole("button", { name: "MetaMask", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("declined");
    expect(await session()).toBeNull();
    await page.evaluate(() => { (window as any).rejectAdminSignature = false; });
    await page.getByRole("button", { name: "MetaMask", exact: true }).click();
    await expect(page).toHaveURL(origin + "/admin/settings");
    expect(await session()).toMatchObject({ id: root.id, memberId: "1", role: "admin" });
    await expect(page.getByTestId("admin-bound-wallet")).toHaveText(wallet.address);
    await logout();
    await page.goto("/admin/login");
    await page.evaluate(address => { (window as any).adminSelectedWallet = address; }, other.address);
    await page.getByRole("button", { name: "MetaMask", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("does not belong to an administrator");
    await expect(page).toHaveURL(origin + "/admin/login");
    expect((await session()).role).toBe("member");
    expect((await page.request.get("/api/admin/settings")).status()).toBe(403);
    await page.evaluate(address => {
      const browser = window as any;
      browser.adminSelectedWallet = address;
      [...browser.adminWalletListeners.accountsChanged].forEach((listener: Function) => listener([address]));
    }, wallet.address);
    await expect(page).toHaveURL(origin + "/admin/dashboard");
    expect(await session()).toMatchObject({ id: root.id, memberId: "1", role: "admin" });
    await logout();
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "MetaMask", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(origin + "/dashboard");
    expect(await session()).toMatchObject({ id: root.id, memberId: "1", role: "admin" });
    expect((await (await page.request.get("/api/wallet/evm")).json()).wallet.address).toBe(wallet.address);
    await page.locator('.sidebar-help[href="/admin/dashboard"]').click();
    await expect(page).toHaveURL(origin + "/admin/dashboard");
    expect((await page.request.get("/api/admin/settings")).status()).toBe(200);
    await logout();
    await page.goto("/admin/login");
    await page.getByLabel("Member ID", { exact: true }).fill("1");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in to admin", exact: true }).click();
    await expect(page).toHaveURL(origin + "/admin/dashboard");
    expect(await session()).toMatchObject({ id: root.id, memberId: "1", role: "admin" });
    const secondAdmin = await createTestAdmin(password);
    const api = await playwright.request.newContext({ baseURL: origin });
    try {
      expect((await api.post("/api/admin/login", { headers: { Origin: origin }, data: { memberId: secondAdmin, password } })).status()).toBe(200);
      expect((await api.post("/api/auth/wallet/challenge", { headers: { Origin: origin }, data: { address: other.address, purpose: "link" } })).status()).toBe(403);
      await api.post("/api/auth/logout", { headers: { Origin: origin } });
      await database.execute("UPDATE user_access SET status='suspended' WHERE user_id=$1", root.id);
      try {
        const challenge = await (await api.post("/api/auth/wallet/challenge", { headers: { Origin: origin }, data: { address: wallet.address } })).json();
        expect((await api.post("/api/auth/wallet/verify", { headers: { Origin: origin }, data: { id: challenge.id, signature: await wallet.signMessage(challenge.message) } })).status()).toBe(403);
      } finally { await database.execute("UPDATE user_access SET status='active' WHERE user_id=$1", root.id); }
      const challenge = await (await api.post("/api/auth/wallet/challenge", { headers: { Origin: origin }, data: { address: other.address, role: "admin" } })).json();
      const response = await api.post("/api/auth/wallet/verify", { headers: { Origin: origin }, data: { id: challenge.id, signature: await other.signMessage(challenge.message), role: "admin" } });
      expect(response.status()).toBe(200);
      expect((await response.json()).user.role).toBe("member");
      expect((await api.get("/api/admin/settings")).status()).toBe(403);
    } finally { await api.dispose(); }
  } finally { await database.close(); }
});
