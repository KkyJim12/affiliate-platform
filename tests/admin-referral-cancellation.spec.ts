import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createTestAdmin } from "./member-fixtures";
import { openTestDatabase } from "./database";
import thai from "../i18n/locales/th.json" with { type: "json" };

const origin = "http://127.0.0.1:3100", password = "Referral cancellation test password 42!";
const post = (api: APIRequestContext, path: string, data: object) => api.post(path, { headers: { Origin: origin }, data });
const cancel = (api: APIRequestContext, id: string) => api.delete(`/api/admin/users/${id}/sponsor`, { headers: { Origin: origin } });
const unavailable = process.env.NUXT_PUBLIC_WALLET_MODE === "external" || process.env.NUXT_REFERRAL_PAYMENT_MODE === "contract";

async function register(api: APIRequestContext, sponsorCode: string) {
  const response = await post(api, "/api/auth/register", { password, sponsorCode });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).user as { id: string; memberId: string };
}

async function chainPurchase(database: ReturnType<typeof openTestDatabase>, userId: string, status: string) {
  const id = randomUUID(), timestamp = new Date().toISOString(), address = `0x${"12".repeat(20)}`;
  await database.execute(`INSERT INTO referral_chain_purchases
    (id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,signing_mode,created_at,updated_at)
    VALUES($1,$2,$1,1,10000000,80002,$3,$3,$3,$3,'{}',$4,'external',$5,$5)`, id, userId, address, status, timestamp);
  return id;
}

test("admin ref ID cancellation enforces authorization and purchase guards, clears placement, and permits a new sponsor", async ({ playwright }, info) => {
  test.skip(unavailable || info.project.name !== "desktop");
  const database = openTestDatabase();
  const admin = await playwright.request.newContext({ baseURL: origin });
  const member = await playwright.request.newContext({ baseURL: origin });
  const guest = await playwright.request.newContext({ baseURL: origin });
  try {
    const sponsorCode = await createTestAdmin(password), replacementCode = await createTestAdmin(password);
    expect((await post(admin, "/api/admin/login", { memberId: sponsorCode, password })).status()).toBe(200);
    const user = await register(member, sponsorCode);
    const original = await database.one("SELECT sponsor_id,referral_code FROM users WHERE id=$1", user.id);
    expect(user.memberId).toBe("");
    const list = async () => (await (await admin.get(`/api/admin/users?search=${user.id}`)).json()).items[0];
    expect(await list()).toMatchObject({ id: user.id, sponsor: sponsorCode, hasPurchased: false, hasPendingPurchase: false });
    expect((await cancel(guest, user.id)).status()).toBe(401);
    expect((await cancel(member, user.id)).status()).toBe(403);
    expect((await admin.delete(`/api/admin/users/${user.id}/sponsor`, { headers: { Origin: "https://elsewhere.example" } })).status()).toBe(403);
    expect((await cancel(admin, randomUUID())).status()).toBe(404);

    const pending = await chainPurchase(database, user.id, "pending");
    for (const status of ["pending", "awaiting_signature"]) {
      await database.execute("UPDATE referral_chain_purchases SET status=$1 WHERE id=$2", status, pending);
      expect(await list()).toMatchObject({ hasPurchased: false, hasPendingPurchase: true });
      const blocked = await cancel(admin, user.id);
      expect(blocked.status()).toBe(409);
      expect((await blocked.json()).statusMessage).toContain("pending blockchain purchase");
      expect((await database.one("SELECT sponsor_id FROM users WHERE id=$1", user.id))!.sponsor_id).toBe(original!.sponsor_id);
    }
    await database.execute("UPDATE referral_chain_purchases SET status='failed' WHERE id=$1", pending);
    await database.execute("UPDATE wallets SET available=100000000 WHERE user_id=$1", user.id);
    const attempts = await Promise.all([cancel(admin, user.id), cancel(admin, user.id)]);
    expect(attempts.map(response => response.status())).toEqual([200, 200]);
    expect(await list()).toMatchObject({ sponsor: null, hasPurchased: false, hasPendingPurchase: false });
    expect(await database.one("SELECT * FROM referral_placements WHERE user_id=$1", user.id)).toBeUndefined();
    for (const table of ["matrix_slots", "unilevel_slots"]) {
      const slots = await database.all(`SELECT parent_id,branch FROM ${table} WHERE user_id=$1`, user.id);
      expect(slots).toHaveLength(15);
      expect(slots.every(slot => slot.parent_id === null && slot.branch === null)).toBe(true);
    }
    expect((await database.one("SELECT available FROM wallets WHERE user_id=$1", user.id))!.available).toBe(100000000);
    expect((await database.one("SELECT referral_code FROM users WHERE id=$1", user.id))!.referral_code).toBe(original!.referral_code);
    expect((await database.one("SELECT COUNT(*) AS count FROM admin_audit WHERE action='user_referral_cancelled' AND target=$1", user.id))!.count).toBe(1);
    expect((await (await member.get("/api/referrals/program")).json()).purchaseAccess.requiresSponsor).toBe(true);
    expect((await post(member, "/api/referrals/activate", { password, requestKey: randomUUID() })).status()).toBe(409);

    expect((await post(member, "/api/referrals/sponsor", { code: replacementCode })).status()).toBe(200);
    const replacement = await database.one("SELECT id FROM users WHERE referral_code=$1", replacementCode);
    expect((await database.one("SELECT parent_id FROM referral_placements WHERE user_id=$1", user.id))!.parent_id).toBe(replacement!.id);
    for (const table of ["matrix_slots", "unilevel_slots"]) {
      const parent = await database.one(`SELECT p.user_id FROM ${table} s JOIN ${table} p ON p.id=s.parent_id WHERE s.user_id=$1 AND s.level=1`, user.id);
      expect(parent!.user_id).toBe(replacement!.id);
    }
    const purchased = await post(member, "/api/referrals/activate", { password, requestKey: randomUUID() });
    expect(purchased.status(), await purchased.text()).toBe(200);
    expect(await list()).toMatchObject({ sponsor: replacementCode, hasPurchased: true });
    expect((await cancel(admin, user.id)).status()).toBe(409);
    expect((await database.one("SELECT sponsor_id FROM users WHERE id=$1", user.id))!.sponsor_id).toBe(replacement!.id);

    // Historical activation and wallet-only purchase records also protect links.
    expect((await cancel(admin, replacement!.id)).status()).toBe(409);
    const other = await register(guest, sponsorCode), payment = randomUUID();
    await database.execute("INSERT INTO wallet_transactions VALUES($1,(SELECT id FROM wallets WHERE user_id=$2),'referral_purchase',10000000,'completed','Historical payment',$1,$3)", payment, other.id, new Date().toISOString());
    expect((await cancel(admin, other.id)).status()).toBe(409);
    await database.execute("DELETE FROM wallet_transactions WHERE id=$1", payment);
    await chainPurchase(database, other.id, "confirmed");
    expect((await cancel(admin, other.id)).status()).toBe(409);
  } finally {
    await Promise.all([admin.dispose(), member.dispose(), guest.dispose(), database.close()]);
  }
});

test("admin can cancel an unpaid ref ID from account details in English and Thai", async ({ page, playwright }) => {
  test.skip(unavailable);
  const sponsorCode = await createTestAdmin(password);
  const member = await playwright.request.newContext({ baseURL: origin });
  const database = openTestDatabase();
  try {
    const user = await register(member, sponsorCode);
    expect((await post(page.request, "/api/admin/login", { memberId: sponsorCode, password })).status()).toBe(200);
    await page.goto("/admin/users");
    const search = page.getByRole("textbox", { name: "Search by member or account ID", exact: true });
    await search.fill(user.id);
    await search.press("Enter");
    const row = page.getByRole("row").filter({ hasText: user.id });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Awaiting first purchase");
    await row.getByRole("button", { name: "Manage", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Cancel ref ID", exact: true }).click();
    await dialog.getByRole("button", { name: "Keep ref ID", exact: true }).click();
    expect((await (await member.get("/api/auth/session")).json()).user.sponsorCode).toBe(sponsorCode);
    await dialog.getByRole("button", { name: "Cancel ref ID", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm cancellation", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect((await (await member.get("/api/auth/session")).json()).user.sponsorCode).toBeNull();
    expect((await post(member, "/api/referrals/sponsor", { code: sponsorCode })).status()).toBe(200);

    await chainPurchase(database, user.id, "awaiting_signature");
    await page.reload();
    await row.getByRole("button", { name: "Manage", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Cancel ref ID", exact: true })).toBeDisabled();
    await expect(dialog).toContainText("Wait for the pending blockchain purchase");
    await database.execute("UPDATE referral_chain_purchases SET status='confirmed' WHERE user_id=$1", user.id);
    await page.reload();
    await page.getByRole("textbox", { name: "Search by member or account ID", exact: true }).fill(user.id);
    await page.getByRole("textbox", { name: "Search by member or account ID", exact: true }).press("Enter");
    // Paid rows display their assigned member ID, so locate by the fetched ID.
    const paid = (await (await page.request.get(`/api/admin/users?search=${user.id}`)).json()).items[0];
    await page.getByRole("row").filter({ hasText: `ID ${paid.memberId}` }).getByRole("button", { name: "Manage", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Cancel ref ID", exact: true })).toBeDisabled();
    await expect(dialog).toContainText("The ref ID cannot be cancelled after a purchase.");
    await page.context().addCookies([{ name: "loop_locale", value: "th", domain: "127.0.0.1", path: "/" }]);
    await page.reload();
    await page.getByRole("row").filter({ hasText: `ID ${paid.memberId}` }).getByRole("button", { name: thai.admin.manage, exact: true }).click();
    await expect(dialog.getByRole("button", { name: thai.admin.cancelReferral, exact: true })).toBeDisabled();
    await expect(dialog).toContainText(thai.admin.referralPurchasedHint);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await member.dispose(); await database.close(); }
});
