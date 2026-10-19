import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openTestDatabase } from "./database";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../server/lib/password";
import thai from "../i18n/locales/th.json" with { type: "json" };
const origin = "http://127.0.0.1:3100";
const password = "An explorer test password 42!";
const post = (api: APIRequestContext, path: string, data: object) => api.post(path, { headers: { Origin: origin }, data });
async function fixture() {
    const suffix = Date.now().toString(36) + randomUUID().slice(0, 3);
    const adminName = `exa_${suffix}`;
    execFileSync(process.execPath, ["scripts/create-admin.mjs"], { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, LOOP_ADMIN_USERNAME: adminName, LOOP_ADMIN_PASSWORD: password, NODE_NO_WARNINGS: "1" }, stdio: "pipe" });
    const database = openTestDatabase();
    const admin = await database.one("SELECT id FROM users WHERE username = $1", adminName) as {
        id: string;
    };
    const hashed = await hashPassword(password);
    const now = new Date().toISOString();
    const create = async (prefix: string, sponsor: string | null = null) => {
        const id = randomUUID(), username = `${prefix}_${suffix}`, walletId = `LW-${randomUUID()}`;
        await database.execute("INSERT INTO users VALUES ($1, $2, $3, $4, $5, $6)", id, username, hashed, `UNXO-${randomUUID().slice(0, 8).toUpperCase()}`, sponsor, now);
        await database.execute("INSERT INTO wallets (id, user_id) VALUES ($1, $2)", walletId, id);
        return { id, username, walletId };
    };
    const owner = await create("exo");
    const outsider = await create("exz");
    const descendants: Awaited<ReturnType<typeof create>>[] = [];
    let parent = owner.id;
    for (let depth = 1; depth <= 16; depth++) {
        const child = await create(`ex${depth}`, parent);
        descendants.push(child);
        parent = child.id;
    }
    const insert = async (walletId: string, type: string, amount: number, status = "completed", description = "Explorer fixture credit", createdAt = now) => {
        const id = randomUUID();
        await database.execute("INSERT INTO wallet_transactions VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", id, walletId, type, amount, status, description, randomUUID(), createdAt);
        return id;
    };
    const settledId = await insert(owner.walletId, "deposit", 12500000);
    const reference = `EXPLORER-${suffix}`;
    await database.execute("INSERT INTO payment_reviews VALUES ($1, 'approved', $2, 'Verified receipt', $3, $4)", settledId, reference, admin.id, now);
    await insert(owner.walletId, "transfer_out", 2500000, "completed", `Transfer to @${descendants[0]!.username}`);
    await insert(descendants[0]!.walletId, "transfer_in", 2500000, "completed", `Transfer from @${owner.username}`);
    const pendingId = await insert(owner.walletId, "deposit", 3250000, "pending");
    const rejectedId = await insert(owner.walletId, "deposit", 4500000, "pending");
    await database.execute("INSERT INTO payment_reviews VALUES ($1, 'rejected', NULL, 'Receipt not verified', $2, $3)", rejectedId, admin.id, now);
    const oldId = await insert(owner.walletId, "commission", 1750000, "completed", "Older explorer commission", new Date(Date.now() - 120 * 86400000).toISOString());
    for (let i = 0; i < 14; i++)
        await insert(owner.walletId, "commission", 100000);
    const outsiderId = await insert(outsider.walletId, "deposit", 99000000);
    await database.execute("UPDATE wallets SET available = $1 WHERE id = $2", 13150000, owner.walletId);
    await database.execute("UPDATE wallets SET available = $1 WHERE id = $2", 2500000, descendants[0]!.walletId);
    await database.execute("UPDATE wallets SET available = $1 WHERE id = $2", 99000000, outsider.walletId);
    await database.close();
    return { adminName, owner, outsider, descendants, settledId, pendingId, rejectedId, oldId, outsiderId, reference };
}
async function ready(page: Page, path: string) {
    await page.goto(path);
    await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & {
        __vue_app__?: unknown;
    })?.__vue_app__));
}
async function dropdown(page: Page, label: string, value: string) {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("listbox").locator(`[role="option"][data-value="${value}"]`).click();
}
test("explorer APIs enforce network boundaries and wallet ownership with accurate filtered totals", async ({ playwright }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Shared API coverage.");
    const data = await fixture();
    const member = await playwright.request.newContext({ baseURL: origin });
    const admin = await playwright.request.newContext({ baseURL: origin });
    const guest = await playwright.request.newContext({ baseURL: origin });
    try {
        for (const part of ["network", "transactions"]) {
            expect((await guest.get(`/api/explorer/${part}`)).status()).toBe(401);
            expect((await guest.get(`/api/admin/explorer/${part}`)).status()).toBe(401);
        }
        expect((await guest.get("/api/dashboard")).status()).toBe(401);
        expect((await post(member, "/api/auth/login", { username: data.owner.username, password })).status()).toBe(200);
        expect((await post(admin, "/api/admin/login", { username: data.adminName, password })).status()).toBe(200);
        const overview = await (await member.get(`/api/dashboard?userId=${data.outsider.id}`)).json();
        expect(overview).toEqual({ commissions: 3.15, directCommissions: 0, bonusCommissions: 0, pendingFunding: 3.25, completedTransfers: 1, referrals: { direct: 1, total: 15, depth: 15, truncated: false } });
        for (const part of ["network", "transactions"])
            expect((await member.get(`/api/admin/explorer/${part}`)).status()).toBe(403);
        const network = await (await member.get("/api/explorer/network")).json();
        expect(network.members).toHaveLength(15);
        expect(network.root.username).toBe(data.owner.username);
        expect(network.members.at(-1).depth).toBe(15);
        expect(JSON.stringify(network)).not.toContain(data.outsider.username);
        expect(JSON.stringify(network)).not.toContain("password_hash");
        for (const id of [data.outsider.id, data.descendants[15]!.id, randomUUID()])
            expect((await member.get(`/api/explorer/network?root=${id}`)).status()).toBe(404);
        const branch = await (await member.get(`/api/explorer/network?root=${data.descendants[0]!.id}`)).json();
        expect(branch.remainingDepth).toBe(14);
        expect(branch.members).toHaveLength(14);
        const adminBranch = await (await admin.get(`/api/admin/explorer/network?username=${data.descendants[0]!.username}`)).json();
        expect(adminBranch.members).toHaveLength(15);
        expect(adminBranch.remainingDepth).toBe(15);
        const activity = await (await member.get(`/api/explorer/transactions?userId=${data.outsider.id}&admin=true`)).json();
        expect(activity.total).toBe(19);
        expect(activity.items).toHaveLength(12);
        expect(activity.items.every((item: {
            username: string;
        }) => item.username === data.owner.username)).toBe(true);
        expect(activity.summary).toEqual({ credits: 15.65, debits: 2.5, pending: 3.25 });
        expect((await (await member.get("/api/explorer/transactions?page=2")).json()).items).toHaveLength(7);
        expect((await (await member.get(`/api/explorer/transactions?search=${data.outsiderId}`)).json()).total).toBe(0);
        expect((await (await member.get(`/api/explorer/transactions?search=${data.oldId}&period=7`)).json()).total).toBe(0);
        const rejected = await (await member.get("/api/explorer/transactions?status=rejected")).json();
        expect(rejected.items[0]).toMatchObject({ id: data.rejectedId, status: "rejected", note: "Receipt not verified" });
        expect(rejected.summary).toEqual({ credits: 0, debits: 0, pending: 0 });
        const reference = await (await member.get(`/api/explorer/transactions?search=${data.reference}`)).json();
        expect(reference.items[0].id).toBe(data.settledId);
        expect((await member.get("/api/explorer/transactions?status=invalid")).status()).toBe(400);
        const global = await (await admin.get(`/api/admin/explorer/transactions?search=${data.outsiderId}`)).json();
        expect(global.items[0]).toMatchObject({ id: data.outsiderId, username: data.outsider.username, amount: 99 });
        // Totals must include records older than the wallet's 200-item activity window.
        const database = openTestDatabase();
        try {
            await database.execute("INSERT INTO wallet_transactions VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", randomUUID(), data.owner.walletId, "deposit", 7000000, "pending", "Older pending request", randomUUID(), new Date(Date.now() - 365 * 86400000).toISOString());
            const timestamp = new Date(Date.now() + 1000).toISOString();
            for (let index = 0; index < 201; index++)
                await database.execute("INSERT INTO wallet_transactions VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", randomUUID(), data.owner.walletId, "commission", 10000, "completed", "Recent commission", randomUUID(), timestamp);
            await database.execute("UPDATE wallets SET available = available + 2010000 WHERE id = $1", data.owner.walletId);
        }
        finally {
            await database.close();
        }
        const recent = await (await member.get("/api/wallet")).json();
        expect(recent.transactions).toHaveLength(200);
        expect(recent.transactions.every((item: {
            type: string;
        }) => item.type === "commission")).toBe(true);
        const complete = await (await member.get("/api/dashboard")).json();
        expect(complete.commissions).toBe(5.16);
        expect(complete.pendingFunding).toBe(10.25);
    }
    finally {
        await Promise.all([member.dispose(), admin.dispose(), guest.dispose()]);
    }
});
test("member and admin explorers support branch navigation, transaction details, localization and themes", async ({ page }, testInfo) => {
    test.setTimeout(60000);
    const data = await fixture();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "warning" && /i18n|hydration/i.test(message.text()))
        errors.push(message.text()); });
    await post(page.request, "/api/auth/login", { username: data.owner.username, password });
    await ready(page, "/dashboard");
    await expect(page.getByTestId("overview-commissions")).toContainText("3.15");
    await expect(page.getByTestId("overview-direct-referrals")).toHaveText("1");
    await expect(page.getByTestId("overview-network-members")).toHaveText("15");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
    await ready(page, "/explorer?tab=network");
    await expect(page.getByRole("tab", { name: "Network", exact: true })).toHaveAttribute("aria-selected", "true");
    const child = data.descendants[0]!;
    await page.getByRole("button", { name: `Inspect ${child.username}`, exact: true }).click();
    await page.getByRole("button", { name: "Explore this branch", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`root=${child.id}`));
    await expect(page.locator('.explorer-panel-heading h2')).toHaveText(`@${child.username}`);
    await page.reload();
    await page.waitForFunction(() => Boolean((document.querySelector("#__nuxt") as HTMLElement & {
        __vue_app__?: unknown;
    })?.__vue_app__));
    await expect(page.locator('.explorer-panel-heading h2')).toHaveText(`@${child.username}`);
    await page.getByRole("button", { name: "My network", exact: true }).click();
    await expect(page.locator('.explorer-panel-heading h2')).toHaveText(`@${data.owner.username}`);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download image", exact: true }).click();
    expect((await download).suggestedFilename()).toContain(".svg");
    await page.getByRole("tab", { name: "Transactions", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.getByTestId("contract-explorer")).toBeVisible();
    await dropdown(page, "Filter transaction status", "pending");
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page.getByRole("textbox", { name: "Search transaction hash or wallet address", exact: true }).fill(data.reference);
    await page.getByRole("textbox", { name: "Search transaction hash or wallet address", exact: true }).press("Enter");
    await expect(page.locator(".explorer-table tbody")).not.toContainText(data.pendingId);
    await expect(page.locator(".explorer-table tbody")).not.toContainText(data.reference);
    await page.getByRole("button", { name: "Use dark theme", exact: true }).click();
    await dropdown(page, "Language", "th");
    await expect(page.getByRole("tab", { name: thai.explorer.transactions, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("select, option")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/explorer-member-${testInfo.project.name}.png`, animations: "disabled" });
    await post(page.request, "/api/auth/logout", {});
    await ready(page, `/admin/explorer?tab=transactions&q=${data.outsiderId}`);
    await expect(page).toHaveURL(/\/admin\/login\?redirect=/);
    await page.getByLabel(thai.ui.username, { exact: true }).fill(data.adminName);
    await page.getByLabel(thai.ui.password, { exact: true }).fill(password);
    await page.getByRole("button", { name: thai.admin.signIn, exact: true }).click();
    await expect(page).toHaveURL(`${origin}/admin/explorer?tab=transactions&q=${data.outsiderId}`);
    await expect(page.getByTestId("contract-explorer")).toBeVisible();
    await expect(page.locator(".explorer-table tbody")).not.toContainText(data.outsider.username);
    await page.getByRole("tab", { name: thai.explorer.network, exact: true }).click();
    await page.getByLabel(thai.explorer.accountRoot, { exact: true }).fill(data.owner.username);
    await page.getByRole("button", { name: thai.explorer.openNetwork, exact: true }).click();
    await expect(page.locator('.explorer-panel-heading h2')).toHaveText(`@${data.owner.username}`);
    await page.getByRole("textbox", { name: thai.explorer.searchNetwork, exact: true }).fill(child.username);
    await expect(page.locator("[data-tree-node]")).toHaveCount(2);
    await page.getByRole("button", { name: thai.explorer.inspectMember.replace("{username}", child.username), exact: true }).press("Enter");
    await expect(page.locator(".explorer-member-detail h2")).toHaveText(`@${child.username}`);
    await page.screenshot({ path: `test-results/explorer-admin-${testInfo.project.name}.png`, animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
});
test("unsigned explorer opens public contract activity and offers a network preview", async ({ page }) => {
    await ready(page, "/explorer");
    await expect(page.getByTestId("contract-explorer")).toBeVisible();
    await page.getByRole("tab", { name: "Network", exact: true }).click();
    await expect(page.locator("[data-tree-node]")).toHaveCount(9);
    await page.getByRole("tab", { name: "Network", exact: true }).focus();
    await page.getByRole("tab", { name: "Network", exact: true }).press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toBeFocused();
    await expect(page.getByRole("heading", { name: "Platform contract transactions", exact: true })).toBeVisible();
    await expect(page.getByTestId("contract-explorer")).toBeVisible();
    await expect(page.locator("select, option")).toHaveCount(0);
});
