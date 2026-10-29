import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../server/lib/password";
import { openTestDatabase } from "./database";

const origin = "http://127.0.0.1:3100";
const password = "Matrix integration testing 42!";

test.beforeEach(async()=>{
  const database=openTestDatabase();
  try {await database.execute("DELETE FROM rate_limits");} finally {await database.close();}
});

test("paid binary matrices recycle and automatically debit the wallet for the next level", async ({ playwright, page }, info) => {
  test.skip(info.project.name !== "desktop" || process.env.NUXT_REFERRAL_PAYMENT_MODE === "contract");
  test.setTimeout(180000);
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
    const extraId = randomUUID();
    let extraCode = "";
    for(let index=0;index<14;index++) {
      const id = randomUUID(), code = await create(id,rootId,10_000_000);
      if (index === 13) {
        // Registration overflow reserves the next cycle, but the last unpaid
        // branch must keep it out of both the tree and the public selector.
        extraCode = await create(extraId,rootId,0);
        const waiting = await (await api.get(`/api/referrals/tree?id=${rootCode}&mode=matrix`)).json();
        expect(waiting.cycles).toEqual([0]);
        expect(waiting.levels.map((row:{filled:number})=>row.filled)).toEqual([2,4,7]);
        expect((await api.get(`/api/referrals/tree?id=${rootCode}&mode=matrix&cycle=1`)).status()).toBe(404);
        expect((await database.one("SELECT COUNT(*) AS count FROM matrix_auto_upgrades WHERE user_id=$1",rootId))!.count).toBe(0);
      }
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
    const recycled = await (await api.get(`/api/referrals/tree?id=${rootCode}&mode=matrix&cycle=1`)).json();
    expect(recycled.members.map((member: { id: string })=>member.id)).toEqual([rootCode,extraCode]);
    expect(recycled.members[1].purchased).toBe(false);
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
    // Fill the rebirth using the same placement and commission rules. Completing
    // another level-1 slot must now buy level 3, rather than stop at level 2.
    await database.execute("UPDATE wallets SET available=10000000 WHERE user_id=$1",extraId);
    await post("/api/auth/login",{memberId:extraCode,password});
    expect((await post("/api/referrals/activate",{password,requestKey:randomUUID()})).status()).toBe(200);
    for (let index=1;index<14;index++) {
      const code=await create(randomUUID(),rootId,10_000_000);
      await post("/api/auth/login",{memberId:code,password});
      if(index===13) await database.execute("UPDATE wallets SET available=0 WHERE user_id=$1",rootId);
      const response=await post("/api/referrals/activate",{password,requestKey:randomUUID()});
      expect(response.status(),await response.text()).toBe(200);
    }
    await expect.poll(async()=> (await database.one("SELECT last_error FROM referral_auto_upgrades WHERE user_id=$1 AND level=3",rootId))?.last_error,{timeout:45000}).toBeTruthy();
    expect((await database.one("SELECT available FROM wallets WHERE user_id=$1",rootId))!.available).toBe(5_100_000);
    expect((await database.one("SELECT COUNT(*) AS count FROM referral_purchases WHERE user_id=$1 AND level=3",rootId))!.count).toBe(0);
    const rebirth=await (await api.get(`/api/referrals/tree?id=${rootCode}&mode=matrix&cycle=1`)).json();
    expect(rebirth.cycles).toEqual([0,1,2]);
    expect(rebirth.levels.map((row:{filled:number})=>row.filled)).toEqual([2,4,8]);
    await database.execute("UPDATE wallets SET available=available+40000000 WHERE user_id=$1",rootId);
    await expect.poll(async()=> (await database.one("SELECT status FROM referral_auto_upgrades WHERE user_id=$1 AND level=3",rootId))?.status,{timeout:45000}).toBe('completed');
    expect((await database.one("SELECT available FROM wallets WHERE user_id=$1",rootId))!.available).toBe(5_100_000);
    expect((await database.one("SELECT COUNT(*) AS count FROM referral_purchases WHERE user_id=$1 AND level=3",rootId))!.count).toBe(1);
    await tree.getByRole("button",{name:"Binary matrix",exact:true}).click();
    await expect(tree.getByTestId('matrix-slot-summary')).toContainText('14/14 paid positions');
    const slots=tree.getByRole('combobox',{name:'Matrix slot',exact:true});
    await expect(slots).toContainText('Initial slot');
    await slots.click();
    await page.getByRole('option',{name:'Rebirth 1',exact:true}).click();
    await expect(tree.getByTestId('matrix-slot-summary')).toContainText('Slot 2: 14/14');
    await slots.click();
    await page.getByRole('option',{name:'Rebirth 2',exact:true}).click();
    await expect(tree.getByTestId('matrix-slot-summary')).toContainText('Slot 3: 0/14');
  } finally { await api.dispose(); await database.close(); }
});

test("a referred member inherits two rows, their branch fills the last row and upgrades under their sponsor",async({playwright},info)=>{
  test.skip(info.project.name!=="desktop" || process.env.NUXT_REFERRAL_PAYMENT_MODE==="contract");
  test.setTimeout(180000);
  const database=openTestDatabase(),hash=await hashPassword(password);
  const ownerApi=await playwright.request.newContext({baseURL:origin}),memberApi=await playwright.request.newContext({baseURL:origin}),buyerApi=await playwright.request.newContext({baseURL:origin});
  const create=async(sponsor:string|null,amount:number)=>{
    const id=randomUUID();
    const row=await database.one("INSERT INTO users VALUES($1,$2,$3,$1,$4,$5) RETURNING referral_code",id,`branch_${id.slice(0,8)}`,hash,sponsor,new Date().toISOString());
    await database.execute("INSERT INTO wallets(id,user_id,available) VALUES($1,$2,$3)",`w-${id}`,id,amount);
    return {id,code:row!.referral_code as string};
  };
  const activate=async(member:{code:string},api:typeof ownerApi)=>{
    expect((await api.post('/api/auth/login',{headers:{Origin:origin},data:{memberId:member.code,password}})).status()).toBe(200);
    const response=await api.post('/api/referrals/activate',{headers:{Origin:origin},data:{password,requestKey:randomUUID()}});
    expect(response.status(),await response.text()).toBe(200);
  };
  const matrix=async(code:string,level=1,cycle=0)=> (await ownerApi.get(`/api/referrals/tree?id=${code}&mode=matrix&level=${level}&cycle=${cycle}`)).json();
  try {
    const owner=await create(null,100_000_000);await activate(owner,ownerApi);
    const member=await create(owner.id,100_000_000);await activate(member,memberApi);
    for(let index=2;index<=14;index++) await activate(await create(owner.id,10_000_000),buyerApi);
    await expect.poll(async()=> (await database.one("SELECT status FROM referral_auto_upgrades WHERE user_id=$1 AND level=2",owner.id))?.status,{timeout:45000}).toBe('completed');
    const inherited=await matrix(member.code);
    expect(inherited.levels.map((row:{filled:number})=>row.filled)).toEqual([2,4,0]);
    expect(inherited.members).toHaveLength(7);
    const inheritedSponsors=await database.all("SELECT sponsor_id FROM users WHERE referral_code=ANY($1::TEXT[])",inherited.members.slice(1).map((row:{id:string})=>row.id));
    expect(inheritedSponsors.every(row=>row.sponsor_id===owner.id)).toBe(true);
    const ownerExtra=await create(owner.id,0);
    expect((await database.one("SELECT parent_id FROM matrix_slots WHERE user_id=$1 AND level=1 AND cycle=0",ownerExtra.id))!.parent_id).toBe(`matrix:1:${owner.id}:1`);
    expect((await matrix(member.code)).levels.map((row:{filled:number})=>row.filled)).toEqual([2,4,0]);
    const downlineCode=inherited.members.find((row:{path:string})=>row.path==='0').id;
    const downline=await database.one("SELECT id FROM users WHERE referral_code=$1",downlineCode);
    // Both the member's own invites and invites from their placed downline
    // fill the last row. The sponsor's overflow remains in its own rebirth.
    for(let index=0;index<8;index++) await activate(await create(index<4 ? downline!.id : member.id,10_000_000),buyerApi);
    await expect.poll(async()=> (await database.one("SELECT status FROM referral_auto_upgrades WHERE user_id=$1 AND level=2",member.id))?.status,{timeout:45000}).toBe('completed');
    expect((await matrix(member.code)).levels.map((row:{filled:number})=>row.filled)).toEqual([2,4,8]);
    const level2=await matrix(owner.code,2);
    expect(level2.members).toHaveLength(15);
    expect(level2.members.filter((row:{purchased:boolean})=>row.purchased)).toEqual([level2.root,{id:member.code,path:'0',parentId:owner.code,purchased:true}]);
    expect((await database.one("SELECT available FROM wallets WHERE user_id=$1",member.id))!.available).toBe(121_400_000);
    expect((await database.one("SELECT available FROM wallets WHERE user_id=$1",owner.id))!.available).toBe(124_400_000);
    const memberExtra=await create(member.id,0);
    expect((await database.one("SELECT parent_id FROM matrix_slots WHERE user_id=$1 AND level=1 AND cycle=0",memberExtra.id))!.parent_id).toBe(`matrix:1:${member.id}:1`);
    expect((await database.one("SELECT parent_id FROM matrix_slots WHERE user_id=$1 AND level=2 AND cycle=0",member.id))!.parent_id).toBe(`matrix:2:${owner.id}:0`);
    expect((await database.one("SELECT COUNT(*) AS count FROM referral_purchases WHERE user_id=$1 AND level=2",member.id))!.count).toBe(1);
    expect((await database.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE user_id=$1 AND level=1",member.id))!.count).toBe(2);
  } finally {await Promise.all([ownerApi.dispose(),memberApi.dispose(),buyerApi.dispose(),database.close()]);}
});
