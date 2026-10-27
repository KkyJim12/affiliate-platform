import { expect, test, type APIRequestContext } from "@playwright/test";
import { openTestDatabase } from "./database";
import { randomUUID } from "node:crypto";
const origin = "http://127.0.0.1:3100";
const password = "A long integration password 42!";
const post = (api: APIRequestContext, path: string, data: object) => api.post(path, { headers: { Origin: origin }, data });
test("account ownership, sessions, CSRF, funding idempotency, and atomic transfers", async ({ playwright }) => {
    const owner = await playwright.request.newContext({ baseURL: origin });
    const friend = await playwright.request.newContext({ baseURL: origin });
    const stranger = await playwright.request.newContext({ baseURL: origin });
    const suffix = Date.now().toString(36);
    const ownerName = `owner_${suffix}`;
    const friendName = `friend_${suffix}`;
    try {
        expect((await stranger.get("/api/wallet")).status()).toBe(401);
        const crossOrigin = await owner.post("/api/auth/register", { headers: { Origin: "https://unrelated.example" }, data: { username: ownerName, password } });
        expect(crossOrigin.status()).toBe(403);
        const registration = await post(owner, "/api/auth/register", { username: ownerName, password });
        expect(registration.status()).toBe(201);
        const account = (await registration.json()).user;
        expect(JSON.stringify(account)).not.toContain("password");
        const cookie = registration.headers()["set-cookie"]!;
        expect(cookie).toContain("HttpOnly");
        expect(cookie).toContain("SameSite=Strict");
        expect(account).not.toHaveProperty("username");
        const friendRegistration = await post(friend, "/api/auth/register", { username: friendName, password });
        expect(friendRegistration.status()).toBe(201);
        const friendAccount = (await friendRegistration.json()).user;
        const ownerWallet = await (await owner.get("/api/wallet")).json();
        const friendWallet = await (await friend.get("/api/wallet")).json();
        expect(ownerWallet.available).toBe(0);
        expect(ownerWallet.transactions).toEqual([]);
        expect(friendWallet.id).not.toBe(ownerWallet.id);
        expect(account.referralCode).toBeNull();
        expect(friendAccount.referralCode).toBeNull();
        const fundingKey = randomUUID();
        const funding = { amount: "100.123456", requestKey: fundingKey, userId: friendWallet.id };
        const firstFunding = await post(owner, "/api/wallet/deposit", funding);
        expect(firstFunding.status()).toBe(200);
        expect((await firstFunding.json()).available).toBe(0);
        const repeated = await post(owner, "/api/wallet/deposit", funding);
        expect((await repeated.json()).transactions).toHaveLength(1);
        expect((await post(owner, "/api/wallet/deposit", { amount: "101", requestKey: fundingKey })).status()).toBe(409);
        expect((await post(owner, "/api/wallet/deposit", { amount: "-10", requestKey: randomUUID() })).status()).toBe(400);
        expect((await (await friend.get("/api/wallet")).json()).transactions).toEqual([]);
        const insufficient = await post(owner, "/api/wallet/transfer", { amount: "1", recipient: friendAccount.memberId, password, requestKey: randomUUID() });
        expect(insufficient.status()).toBe(400);
        // Credit the isolated test database directly. Production has no mint endpoint.
        const database = openTestDatabase();
        await database.execute("UPDATE wallets SET available = $1 WHERE id = $2", 100000000, ownerWallet.id);
        await database.execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'deposit', $3, 'completed', 'Test-only settled funding', $4, $5)", randomUUID(), ownerWallet.id, 100000000, randomUUID(), new Date().toISOString());
        const stored = await database.one("SELECT password_hash FROM users WHERE id = $1", account.id) as {
            password_hash: string;
        };
        expect(stored.password_hash).not.toContain(password);
        await database.close();
        const transferKey = randomUUID();
        const transferData = { amount: "25.123456", recipient: friendAccount.memberId, password, requestKey: transferKey };
        expect((await post(owner, "/api/wallet/transfer", { ...transferData, password: "incorrect" })).status()).toBe(401);
        expect((await post(owner, "/api/wallet/transfer", transferData)).status()).toBe(200);
        expect((await post(owner, "/api/wallet/transfer", transferData)).status()).toBe(200);
        const afterOwner = await (await owner.get("/api/wallet")).json();
        const afterFriend = await (await friend.get("/api/wallet")).json();
        expect(afterOwner.available).toBe(74.876544);
        expect(afterFriend.available).toBe(25.123456);
        expect(afterOwner.transactions.filter((item: {
            type: string;
        }) => item.type === "transfer_out")).toHaveLength(1);
        expect((await post(owner, "/api/wallet/transfer", { ...transferData, amount: "26" })).status()).toBe(409);
        const competing = await Promise.all([1, 2].map(() => post(owner, "/api/wallet/transfer", { amount: "60", recipient: friendAccount.memberId, password, requestKey: randomUUID() })));
        expect(competing.map((response) => response.status()).sort()).toEqual([200, 400]);
        const finalOwner = await (await owner.get("/api/wallet")).json();
        const finalFriend = await (await friend.get("/api/wallet")).json();
        expect(Math.round((finalOwner.available + finalFriend.available) * 1000000)).toBe(100000000);
        expect(finalOwner.available).toBeGreaterThanOrEqual(0);
        const ownerActivated = await (await post(owner, "/api/referrals/activate", { password, requestKey: randomUUID() })).json();
        const friendActivated = await (await post(friend, "/api/referrals/activate", { password, requestKey: randomUUID() })).json();
        expect((await post(friend, "/api/referrals/sponsor", { code: ownerActivated.user.referralCode })).status()).toBe(200);
        expect((await (await owner.get("/api/referrals")).json()).members[0].memberId).toBe(friendAccount.memberId);
        expect((await (await friend.get("/api/referrals")).json()).members).toEqual([]);
        const grandchildName = `child_${suffix}`;
        const grandchildRegistration = await post(stranger, "/api/auth/register", { password, sponsorCode: friendActivated.user.referralCode });
        expect(grandchildRegistration.status()).toBe(201);
        const grandchildAccount = (await grandchildRegistration.json()).user;
        const ownerNetwork = await (await owner.get("/api/referrals")).json();
        expect(ownerNetwork.members).toHaveLength(1);
        expect(ownerNetwork.network).toHaveLength(2);
        expect(ownerNetwork.network.find((member: {
            memberId: string;
        }) => member.memberId === friendAccount.memberId)).toMatchObject({ parentId: account.id, depth: 1 });
        expect(ownerNetwork.network.find((member: {
            memberId: string;
        }) => member.memberId === grandchildAccount.memberId)).toMatchObject({ parentId: friendAccount.id, depth: 2 });
        expect((await (await friend.get("/api/referrals")).json()).network).toHaveLength(1);
        expect((await (await stranger.get("/api/referrals")).json()).network).toEqual([]);
        const stolenToken = (await owner.storageState()).cookies;
        await post(owner, "/api/auth/logout", {});
        const stale = await playwright.request.newContext({ baseURL: origin, storageState: { cookies: stolenToken, origins: [] } });
        expect((await stale.get("/api/wallet")).status()).toBe(401);
        await stale.dispose();
    }
    finally {
        await owner.dispose();
        await friend.dispose();
        await stranger.dispose();
    }
});
