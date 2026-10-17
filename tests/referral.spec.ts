import { expect, test, type APIRequestContext } from "@playwright/test";
import { openTestDatabase } from "./database";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../server/lib/password";
import thai from "../i18n/locales/th.json" with { type: "json" };
const origin = "http://127.0.0.1:3100";
const password = "A referral integration password 42!";
const post = (api: APIRequestContext, path: string, data: object) => api.post(path, { headers: { Origin: origin }, data });
const openDb = openTestDatabase;
async function fixture() {
    const suffix = Date.now().toString(36) + randomUUID().slice(0, 3);
    const hashed = await hashPassword(password);
    const db = openDb();
    const create = async (prefix: string, balance: number) => {
        const user = { id: randomUUID(), username: `${prefix}_${suffix}`, reservedCode: `LOOP-${randomUUID().slice(0, 8).toUpperCase()}`, walletId: `LW-${randomUUID()}` };
        await db.execute("INSERT INTO users VALUES ($1, $2, $3, $4, NULL, $5)", user.id, user.username, hashed, user.reservedCode, new Date().toISOString());
        await db.execute("INSERT INTO wallets (id, user_id, available) VALUES ($1, $2, $3)", user.walletId, user.id, balance * 1000000);
        if (balance)
            await db.execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'deposit', $3, 'completed', 'Test-only settled funding', $4, $5)", randomUUID(), user.walletId, balance * 1000000, randomUUID(), new Date().toISOString());
        return user;
    };
    const owner = await create("rfo", 25), member = await create("rfm", 10), other = await create("rfx", 0);
    await db.close();
    return { owner, member, other };
}
test("referral activation charges exactly once and sponsor links enforce ownership, eligibility and cycles", async ({ playwright }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Shared API coverage.");
    const data = await fixture();
    const owner = await playwright.request.newContext({ baseURL: origin });
    const member = await playwright.request.newContext({ baseURL: origin });
    const other = await playwright.request.newContext({ baseURL: origin });
    const guest = await playwright.request.newContext({ baseURL: origin });
    try {
        expect((await guest.get("/api/referrals/program")).status()).toBe(401);
        expect((await post(guest, "/api/referrals/activate", { password, requestKey: randomUUID() })).status()).toBe(401);
        for (const [api, user] of [[owner, data.owner], [member, data.member], [other, data.other]] as const) {
            const session = await post(api, "/api/auth/login", { username: user.username, password });
            expect((await session.json()).user.referralCode).toBeNull();
        }
        expect((await (await owner.get("/api/referrals/program")).json()).code).toBeNull();
        expect((await owner.post("/api/referrals/activate", { headers: { Origin: "https://unrelated.example" }, data: { password, requestKey: randomUUID() } })).status()).toBe(403);
        expect((await post(other, "/api/referrals/activate", { password, requestKey: randomUUID(), amount: 0, userId: data.owner.id })).status()).toBe(400);
        expect((await (await other.get("/api/wallet")).json()).transactions).toEqual([]);
        expect((await post(member, "/api/referrals/sponsor", { code: data.owner.reservedCode })).status()).toBe(400);
        expect((await post(owner, "/api/referrals/activate", { password: "incorrect", requestKey: randomUUID() })).status()).toBe(401);
        const purchases = await Promise.all([1, 2].map(() => post(owner, "/api/referrals/activate", { password, requestKey: randomUUID(), amount: "0", userId: data.other.id })));
        expect(purchases.map(response => response.status())).toEqual([200, 200]);
        const activated = await purchases[0]!.json();
        const code = activated.program.code;
        expect(code).toMatch(/^LOOP-[A-F0-9]{8}$/);
        expect(code).not.toBe(data.owner.reservedCode);
        expect(activated.user.referralCode).toBe(code);
        expect(activated.wallet.available).toBe(15);
        expect(activated.wallet.transactions.filter((item: {
            type: string;
        }) => item.type === "referral_purchase")).toHaveLength(1);
        const retry = await (await post(owner, "/api/referrals/activate", { password, requestKey: randomUUID() })).json();
        expect(retry.program).toEqual(activated.program);
        expect(retry.wallet.available).toBe(15);
        const activity = await (await owner.get("/api/explorer/transactions?type=referral_purchase")).json();
        expect(activity.total).toBe(1);
        expect(activity.summary).toEqual({ credits: 0, debits: 10, pending: 0 });
        expect((await post(owner, "/api/referrals/sponsor", { code })).status()).toBe(400);
        const linked = await (await post(member, "/api/referrals/sponsor", { code: ` ${code.toLowerCase()} `, userId: data.other.id })).json();
        expect(linked.program.sponsor).toEqual({ username: data.owner.username, code });
        expect(linked.wallet.available).toBe(10);
        expect((await (await owner.get("/api/referrals")).json()).network[0].id).toBe(data.member.id);
        expect((await post(member, "/api/referrals/sponsor", { code })).status()).toBe(200);
        const memberActivated = await (await post(member, "/api/referrals/activate", { password, requestKey: randomUUID() })).json();
        expect(memberActivated.wallet.available).toBe(0);
        expect((await post(owner, "/api/referrals/sponsor", { code: memberActivated.program.code })).status()).toBe(400);
        expect((await post(member, "/api/referrals/sponsor", { code: memberActivated.program.code })).status()).toBe(400);
        // A deep descendant must not be allowed to become an ancestor outside the displayed 15 levels.
        const db = openDb();
        let parent = data.owner.id;
        for (let i = 0; i < 17; i++) {
            const id = randomUUID();
            await db.execute("INSERT INTO users VALUES ($1, $2, 'test-only', $3, $4, $5)", id, `rfd_${i}_${randomUUID().slice(0, 8)}`, `UNASSIGNED-${randomUUID()}`, parent, new Date().toISOString());
            parent = id;
        }
        await db.execute("UPDATE users SET sponsor_id = $1 WHERE id = $2", parent, data.member.id);
        await db.close();
        expect((await post(owner, "/api/referrals/sponsor", { code: memberActivated.program.code })).status()).toBe(400);
        expect((await post(other, "/api/referrals/sponsor", { code: memberActivated.program.code })).status()).toBe(200);
        expect((await post(other, "/api/referrals/sponsor", { code })).status()).toBe(409);
        const suspended = openDb();
        await suspended.execute("INSERT INTO user_access VALUES ($1, 'member', 'suspended')", data.owner.id);
        await suspended.close();
        expect((await post(other, "/api/referrals/sponsor", { code })).status()).toBe(400);
        expect((await (await other.get("/api/referrals/program")).json()).code).toBeNull();
    }
    finally {
        await Promise.all([owner.dispose(), member.dispose(), other.dispose(), guest.dispose()]);
    }
});
test("members buy a referral code, connect a sponsor, and retain access in Thai and both themes", async ({ page }, testInfo) => {
    test.setTimeout(60000);
    const data = await fixture();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "warning" && /i18n|hydration/i.test(message.text()))
        errors.push(message.text()); });
    await post(page.request, "/api/auth/login", { username: data.owner.username, password });
    await page.goto("/dashboard");
    await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & {
        __vue_app__?: unknown;
    })?.__vue_app__));
    const menu = page.getByRole("button", { name: "Open navigation", exact: true });
    if (await menu.isVisible())
        await menu.click();
    await page.getByRole("navigation", { name: "Dashboard navigation", exact: true }).getByRole("link", { name: /My referrals/ }).click();
    await expect(page).toHaveURL(`${origin}/referrals`);
    await expect(page.getByTestId("referral-code")).toHaveCount(0);
    await page.getByRole("button", { name: "Activate for 10.00 USDT", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("15.00 USDT");
    await page.getByLabel("Confirm with your password", { exact: true }).fill("incorrect");
    await page.getByRole("button", { name: "Pay 10.00 USDT & activate", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("incorrect");
    await page.getByLabel("Confirm with your password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Pay 10.00 USDT & activate", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const code = (await page.getByTestId("referral-code").textContent())!;
    expect(code).toMatch(/^LOOP-/);
    await page.reload();
    await expect(page.getByTestId("referral-code")).toHaveText(code);
    await page.goto("/dashboard?view=wallet");
    await expect(page.getByTestId("wallet-balance")).toContainText("15.00");
    await expect(page.locator(".wallet-transaction").filter({ hasText: "Referral activation" })).toContainText("−10.00");
    await post(page.request, "/api/auth/logout", {});
    await post(page.request, "/api/auth/login", { username: data.other.username, password });
    await page.goto(`/referrals?ref=${code}`);
    await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & {
        __vue_app__?: unknown;
    })?.__vue_app__));
    await expect(page.getByRole("button", { name: "Activate for 10.00 USDT", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Sponsor referral code", { exact: true })).toHaveValue(code);
    await page.getByRole("button", { name: "Use referral code", exact: true }).click();
    await expect(page.getByTestId("referral-sponsor")).toHaveText("@" + data.owner.username);
    await expect(page.getByLabel("Sponsor referral code", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await page.getByRole("combobox", { name: "Language", exact: true }).click();
    await page.getByRole("listbox").locator('[data-value="th"]').click();
    await expect(page.getByRole("heading", { name: thai.referral.sponsorTitle, exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.getByTestId("referral-sponsor")).toHaveText("@" + data.owner.username);
    await page.screenshot({ path: `test-results/referral-${testInfo.project.name}.png`, fullPage: true, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
});
