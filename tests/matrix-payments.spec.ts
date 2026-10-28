import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../server/lib/password";
import { openTestDatabase } from "./database";

const origin = "http://127.0.0.1:3100";
const password = "Matrix integration testing 42!";

test("paid binary matrices recycle and automatically debit the wallet for the next level", async ({ playwright, page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.NUXT_REFERRAL_PAYMENT_MODE === "contract");
  test.setTimeout(120000);
  const database = openTestDatabase(), api = await playwright.request.newContext({ baseURL: origin });
  const hash = await hashPassword(password), rootId = randomUUID();
  const create = async (id: string, sponsor: string | null, amount: number) => {
    const row = await database.one("INSERT INTO users VALUES($1,$2,$3,$1,$4,$5) RETURNING referral_code", id,`matrix_${id.slice(0,8)}`,hash,sponsor,new Date().toISOString());
    await database.execute("INSERT INTO wallets(id,user_id,available) VALUES($1,$2,$3)",`LW-${id}`,id,amount);
    return row!.referral_code as string;
  };
  const post = (path: string, data: object) => api.post(path,{ headers: { Origin: origin },data });
  try {
    const rootCode = await create(rootId,null,100_000_000);
    await post("/api/auth/login",{ memberId: rootCode,password });
    expect((await post("/api/referrals/activate",{ password,requestKey: randomUUID() })).status()).toBe(200);
    for(let index=0;index<14;index++) {
      const id = randomUUID(), code = await create(id,rootId,10_000_000);
      expect((await post("/api/auth/login",{ memberId: code,password })).status()).toBe(200);
      const response = await post("/api/referrals/activate",{ password,requestKey: randomUUID() });
      expect(response.status(),await response.text()).toBe(200);
    }
    await expect.poll(async () => (await database.one("SELECT status FROM matrix_auto_upgrades WHERE user_id=$1 AND level=2",rootId))?.status,
      { timeout: 45000 }).toBe("completed");
    expect((await database.one("SELECT available FROM wallets WHERE user_id=$1",rootId))!.available).toBe(121_400_000);
    expect((await database.one("SELECT COUNT(*) AS count FROM referral_purchases WHERE user_id=$1 AND level=2",rootId))!.count).toBe(1);
    const matrix = await (await api.get(`/api/referrals/tree?id=${rootCode}&mode=matrix`)).json();
    expect(matrix.maxDepth).toBe(3); expect(matrix.cycles).toEqual([0,1]);
    expect(matrix.levels.map((item: { filled: number })=>item.filled)).toEqual([2,4,8]);
    expect((await api.get(`/api/referrals/tree?id=${rootCode}&mode=matrix&levels=4`)).status()).toBe(400);
    expect((await api.get(`/api/referrals/tree?id=${rootCode}&path=2`)).status()).toBe(400);
    const extraCode = await create(randomUUID(),rootId,0);
    const recycled = await (await api.get(`/api/referrals/tree?id=${rootCode}&mode=matrix&cycle=1`)).json();
    expect(recycled.members.map((member: { id: string })=>member.id)).toEqual([rootCode,extraCode]);
    const unilevel = await (await api.get(`/api/referrals/tree?id=${rootCode}&mode=unilevel&levels=15`)).json();
    expect(unilevel.maxDepth).toBe(15); expect(unilevel.members).toHaveLength(16);
    expect(unilevel.members.find((member: { id: string })=>member.id===extraCode).path.split('/')).toHaveLength(4);
    await page.goto(`/search?id=${rootCode}`);
    const tree = page.getByTestId("binary-referral-tree");
    await expect(tree.getByRole("button",{ name: "Binary matrix",exact: true })).toHaveAttribute("aria-pressed","true");
    await expect(tree.locator('[data-tree-node]')).toHaveCount(15);
    await tree.getByRole("button",{ name: "Unilevel",exact: true }).click();
    await expect(tree.getByRole("button",{ name: "Level 15: 0 members",exact: true })).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally { await api.dispose(); await database.close(); }
});
