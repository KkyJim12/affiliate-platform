import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../server/lib/password";
import { openTestDatabase } from "./database";
import thai from "../i18n/locales/th.json" with { type: "json" };

const origin="http://127.0.0.1:3100", password="Matrix slot browsing 42!";
test.beforeEach(async()=>{
  // Payment scenarios in the same disposable server can exhaust the shared
  // login budget. Each browsing scenario gets its own throttle state.
  const database=openTestDatabase();
  try {await database.execute("DELETE FROM rate_limits");} finally {await database.close();}
});
async function confirmedUpgrade(userId: string,level: number) {
  const database=openTestDatabase(),purchase=randomUUID(),timestamp=new Date().toISOString();
  try {
    // Imported confirmed receipt: the production payment trigger unlocks slots.
    await database.execute(`INSERT INTO referral_chain_purchases(id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,transaction_hash,created_at,updated_at)
      VALUES($1,$2,$1,$3,$4,80002,$5,$5,$5,$5,'{}','confirmed',$6,$7,$7)`,purchase,userId,level,10_000_000*2**(level-1),`0x${'12'.repeat(20)}`,`0x${randomBytes(32).toString('hex')}`,timestamp);
  } finally {await database.close();}
}
async function fixture(paidChildren=14) {
  const database=openTestDatabase(), owner=randomUUID(), timestamp=new Date().toISOString();
  try {
    const member=await database.one("INSERT INTO users VALUES($1,$2,$3,$1,NULL,$4) RETURNING referral_code",owner,`slots_${owner.slice(0,8)}`,await hashPassword(password),timestamp);
    await database.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",`w-${owner}`,owner);
    // Import already paid levels, with no pending purchase or automatic job.
    const purchase=randomUUID();
    await database.execute(`INSERT INTO referral_chain_purchases(id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,transaction_hash,created_at,updated_at)
      VALUES($1,$2,$1,3,40000000,80002,$3,$3,$3,$3,'{}','confirmed',$4,$5,$5)`,purchase,owner,`0x${'12'.repeat(20)}`,`0x${randomBytes(32).toString('hex')}`,timestamp);
    await database.execute("INSERT INTO referral_activations(user_id,chain_purchase_id,created_at) VALUES($1,$2,$3)",owner,purchase,timestamp);
    const children:string[]=[],childIds:string[]=[];
    for (let index=0;index<15;index++) {
      const id=randomUUID();
      const child=await database.one("INSERT INTO users VALUES($1,$2,'unused',$1,$3,$4) RETURNING referral_code",id,`slot_child_${id.slice(0,8)}`,owner,timestamp);
      children.push(child!.referral_code);
      childIds.push(id);
      if(index<paidChildren) await database.execute("UPDATE matrix_slots SET unlocked=TRUE WHERE user_id=$1 AND level=1",id);
    }
    if(paidChildren>=14) {
      await database.execute("UPDATE matrix_slots SET completed_at=$1 WHERE user_id=$2 AND level=1 AND cycle=0",timestamp,owner);
      await database.execute("UPDATE matrix_slots SET opened=TRUE,rebirth_paid=TRUE,unlocked=TRUE WHERE user_id=$1 AND level=1 AND cycle=1",owner);
    }
    return {owner,memberId:member!.referral_code as string,children,childIds};
  } finally {await database.close();}
}

test("slot progress belongs to the signed-in member, counts each cycle independently and paginates",async({playwright},info)=>{
  test.skip(info.project.name!=="desktop");
  const member=await fixture(),api=await playwright.request.newContext({baseURL:origin});
  try {
    expect((await api.get('/api/referrals/slots')).status()).toBe(401);
    expect((await api.post('/api/auth/login',{headers:{Origin:origin},data:{memberId:member.memberId,password}})).status()).toBe(200);
    const catalog=await (await api.get(`/api/referrals/slots?userId=${member.children[0]}`)).json();
    expect(catalog.memberId).toBe(member.memberId);expect(catalog.total).toBe(16);expect(catalog.items).toHaveLength(16);
    const level=await (await api.get('/api/referrals/slots?level=1')).json();
    expect(level.items).toEqual([
      {level:1,cycle:0,status:'completed',filled:14,paid:14,capacity:14},
      {level:1,cycle:1,status:'open',filled:1,paid:0,capacity:14},
    ]);
    expect((await (await api.get('/api/referrals/slots?page=2')).json()).items).toHaveLength(0);
    expect((await (await api.get('/api/referrals/slots?level=2')).json()).items).toHaveLength(1);
    expect((await api.get(`/api/referrals/tree?id=${member.memberId}&mode=matrix&level=2&cycle=1`)).status()).toBe(404);
    expect((await (await api.get('/api/referrals/slots?level=4')).json()).items.every((slot:{status:string})=>slot.status==='locked')).toBe(true);
    for(const query of ['level=16','level=-1','page=0','page=1.5','page=1000001']) expect((await api.get(`/api/referrals/slots?${query}`)).status()).toBe(400);
    const text=JSON.stringify(catalog);
    for(const secret of [member.owner,'password_hash','buyer_address','transaction_hash','slot_child_']) expect(text).not.toContain(secret);
  } finally {await api.dispose();}
});

test("higher program levels place members by purchase order without reserving registration positions",async({request},info)=>{
  test.skip(info.project.name!=="desktop");
  const member=await fixture();
  const tree=async(level:number,mode='matrix')=> (await request.get(`/api/referrals/tree?id=${member.memberId}&mode=${mode}&level=${level}`)).json();
  const before=await tree(2);
  expect(before.root.purchased).toBe(true);
  expect(before.members).toEqual([before.root]);
  expect(before.levels.map((row:{filled:number})=>row.filled)).toEqual([0,0,0]);
  expect((await tree(1)).members).toHaveLength(15);
  await confirmedUpgrade(member.childIds[2]!,2);
  const grandchildOnly=await tree(2);
  expect(grandchildOnly.members).toEqual([before.root,{id:member.children[2],path:'0',parentId:member.memberId,purchased:true}]);
  expect(grandchildOnly.levels.map((row:{filled:number})=>row.filled)).toEqual([1,0,0]);
  const branch=await (await request.get(`/api/referrals/tree?id=${member.memberId}&mode=matrix&level=2&path=0`)).json();
  expect(branch.members).toEqual(grandchildOnly.members.filter((row:{path:string})=>row.path==='0' || row.path.startsWith('0/')));
  expect(branch.members).toContainEqual({id:member.children[2],path:'0',parentId:member.memberId,purchased:true});
  await confirmedUpgrade(member.childIds[0]!,2);
  const upgraded=await tree(2);
  expect(upgraded.members).toEqual([...grandchildOnly.members,{id:member.children[0],path:'1',parentId:member.memberId,purchased:true}]);
  expect(upgraded.levels.map((row:{filled:number})=>row.filled)).toEqual([2,0,0]);
  expect((await tree(3)).members).toEqual(before.members);
  expect((await tree(2,'unilevel')).members).toEqual(upgraded.members);
  expect((await tree(3,'unilevel')).members).toEqual(before.members);
  const database=openTestDatabase();
  try {
    const placement=await database.one(`SELECT p.user_id AS parent FROM matrix_slots s JOIN matrix_slots p ON p.id=s.parent_id
      WHERE s.user_id=$1 AND s.level=2 AND s.cycle=0`,member.childIds[2]);
    expect(placement!.parent).toBe(member.owner);
  } finally {await database.close();}
});

test("level-1 trees tag unpaid referrals and hide reserved rebirths until every position purchases",async({page},info)=>{
  const member=await fixture(1);
  const first=await (await page.request.get(`/api/referrals/tree?id=${member.memberId}&mode=matrix&level=1`)).json();
  expect(first.members.map((row:{id:string})=>row.id)).toEqual([member.memberId,...member.children.slice(0,14)]);
  expect(first.members.filter((row:{purchased:boolean})=>row.purchased).map((row:{id:string})=>row.id)).toEqual([member.memberId,member.children[0]]);
  expect(first.levels.map((row:{filled:number})=>row.filled)).toEqual([1,0,0]);
  expect(first.cycles).toEqual([0]);
  expect((await page.request.get(`/api/referrals/tree?id=${member.memberId}&mode=matrix&level=1&cycle=1`)).status()).toBe(404);
  await confirmedUpgrade(member.childIds[5]!,1);
  const descendant=await (await page.request.get(`/api/referrals/tree?id=${member.memberId}&mode=matrix&level=1`)).json();
  expect(descendant.members).toContainEqual({id:member.children[5],path:'1/1',parentId:member.children[1],purchased:true});
  const higher=await (await page.request.get(`/api/referrals/tree?id=${member.memberId}&mode=matrix&level=2`)).json();
  expect(higher.members).toEqual([higher.root]);
  expect((await page.request.post(`${origin}/api/auth/login`,{headers:{Origin:origin},data:{memberId:member.memberId,password}})).status()).toBe(200);
  await page.goto('/referrals');
  const catalog=page.getByTestId('matrix-slots');
  const card=catalog.locator('[data-testid="matrix-slot-card"][data-level="1"][data-cycle="0"]');
  await expect(card).toContainText('Reserved positions 14/14');
  await expect(card).toContainText('Paid positions 2/14');
  await card.click();
  const tree=page.getByTestId('binary-referral-tree');
  await expect(tree.locator('[data-member-id]')).toHaveCount(15);
  await expect(tree.locator('[data-empty="true"]')).toHaveCount(0);
  await expect(tree.getByTestId('not-purchased-tag')).toHaveCount(12);
  await expect(tree.locator(`[data-member-id="${member.children[1]}"]`)).toContainText('Unpaid');
  await expect(tree.locator(`[data-member-id="${member.children[5]}"]`).getByTestId('not-purchased-tag')).toHaveCount(0);
  await expect(tree.getByTestId('matrix-slot-summary')).toContainText('Slot 1: 2/14 paid positions');
  await expect(tree.getByTestId('matrix-slot-summary')).toContainText('all 14 positions must purchase this level');
  await expect(catalog.locator('.slot-detail-note').first()).toHaveText('Paid positions 2/14');
  await tree.screenshot({path:info.outputPath('unpaid-referral-tree.png')});
});

test("completed cards show their own full referral branches across levels and rebirths",async({page})=>{
  test.setTimeout(90000);
  const member=await fixture(),database=openTestDatabase();
  const first=member.children.slice(0,14),second=[member.children[14]!],secondIds=[member.childIds[14]!];
  try {
    for(let index=0;index<13;index++) {
      const id=randomUUID(),sponsor=index===1 || index===2 ? member.childIds[14] : member.owner;
      const row=await database.one("INSERT INTO users VALUES($1,$2,'unused',$1,$3,$4) RETURNING referral_code",id,`completed_${id.slice(0,8)}`,sponsor,new Date().toISOString());
      second.push(row!.referral_code);secondIds.push(id);
    }
    await database.execute("UPDATE matrix_slots SET unlocked=TRUE WHERE user_id=ANY($1::TEXT[]) AND level=1",secondIds);
    for(const id of member.childIds.slice(0,14)) await confirmedUpgrade(id,2);
    await database.execute("UPDATE matrix_slots SET completed_at=$1 WHERE user_id=$2 AND ((level=1 AND cycle=1) OR (level=2 AND cycle=0))",new Date().toISOString(),member.owner);
    const extra=randomUUID();
    await database.execute("INSERT INTO users VALUES($1,$2,'unused',$1,$3,$4)",extra,`new_cycle_${extra.slice(0,8)}`,member.owner,new Date().toISOString());
  } finally {await database.close();}
  expect((await page.request.post(`${origin}/api/auth/login`,{headers:{Origin:origin},data:{memberId:member.memberId,password}})).status()).toBe(200);
  await page.goto('/referrals');
  const catalog=page.getByTestId('matrix-slots');
  const check=async(level:number,cycle:number,members:string[])=>{
    await catalog.getByRole('combobox',{name:'Filter slots by level'}).click();
    await page.getByRole('option',{name:`Level ${level}`,exact:true}).click();
    const card=catalog.locator(`[data-testid="matrix-slot-card"][data-level="${level}"][data-cycle="${cycle}"]`);
    await expect(card).toHaveAttribute('data-status','completed');
    await expect(card).toContainText('View completed tree');
    await card.click();
    const tree=page.getByTestId('binary-referral-tree');
    await expect(page.locator('.slot-detail-heading')).toContainText(`Level ${level} · ${cycle ? `Reborn ${cycle}` : 'Initial slot'}`);
    await expect(tree.getByTestId('matrix-slot-summary')).toContainText(`Slot ${cycle+1}: 14/14`);
    await expect(tree.locator('[data-member-id]')).toHaveCount(15);
    await expect(tree.locator('[data-empty="true"]')).toHaveCount(0);
    await expect(tree.locator('[data-tree-edge]')).toHaveCount(14);
    await expect(tree.locator('[data-path=""]')).toHaveAttribute('data-member-id',member.memberId);
    for(const [index,id] of members.entries()) {
      const path=(index+2).toString(2).slice(1).split('').join('/');
      await expect(tree.locator(`[data-tree-node][data-path="${path}"]`)).toHaveAttribute('data-member-id',id);
      await expect(tree.locator(`[data-tree-edge][data-child-path="${path}"]`)).toHaveAttribute('data-parent-path',path.split('/').slice(0,-1).join('/'));
    }
    await catalog.getByRole('button',{name:'Back to all slots'}).click();
  };
  await check(1,0,first);
  await check(1,1,second);
  await check(2,0,first);
  await check(1,1,second);
});

test("members browse slots, open each level and rebirth tree, and retain Thai/mobile layouts",async({page},info)=>{
  test.setTimeout(120000);
  const member=await fixture(), errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='warning' && /hydration|i18n/i.test(message.text())) errors.push(message.text());});
  expect((await page.request.post(`${origin}/api/auth/login`,{headers:{Origin:origin},data:{memberId:member.memberId,password}})).status()).toBe(200);
  await page.goto('/referrals');
  const catalog=page.getByTestId('matrix-slots'), cards=catalog.getByTestId('matrix-slot-card');
  await expect(page.getByRole('button',{name:'Matrix slots',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(cards).toHaveCount(16);
  await expect(page.getByTestId('binary-referral-tree')).toHaveCount(0);
  await catalog.getByRole('combobox',{name:'Filter slots by level'}).click();
  await page.getByRole('option',{name:'Level 1',exact:true}).click();
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText('Paid positions 14/14');
  await catalog.screenshot({path:info.outputPath('matrix-slots-en.png')});
  await catalog.locator('[data-testid="matrix-slot-card"][data-cycle="1"]').click();
  const tree=page.getByTestId('binary-referral-tree');
  await expect(page.locator('.slot-detail-heading')).toContainText('Level 1 · Reborn 1');
  await expect(tree.getByTestId('matrix-slot-summary')).toContainText('Slot 2: 0/14');
  await expect(tree.locator(`[data-member-id="${member.children[14]}"]`)).toContainText('Unpaid');
  await expect(tree.locator(`[data-member-id="${member.children[0]}"]`)).toHaveCount(0);
  await expect(tree.getByRole('combobox',{name:'Explore the 15 purchase levels'})).toHaveCount(0);
  await catalog.getByRole('button',{name:'Back to all slots'}).click();
  await expect(cards).toHaveCount(2);
  await expect(catalog.locator('[data-testid="matrix-slot-card"][data-cycle="1"]')).toBeFocused();
  await catalog.getByRole('combobox',{name:'Filter slots by level'}).click();
  await page.getByRole('option',{name:'Level 2',exact:true}).click();
  await catalog.locator('[data-testid="matrix-slot-card"][data-level="2"][data-cycle="0"]').click();
  await expect(page.locator('.slot-detail-heading')).toContainText('Level 2 · Initial slot');
  await expect(tree.getByTestId('matrix-slot-summary')).toContainText('Slot 1: 0/14');
  await expect(tree.locator('[data-empty="true"]')).toHaveCount(14);
  await expect(tree.getByTestId('not-purchased-tag')).toHaveCount(0);
  await confirmedUpgrade(member.childIds[2]!,2);
  await expect(tree.locator('[data-path="0"]')).toHaveAttribute('data-member-id',member.children[2]!,{timeout:25000});
  await expect(tree.getByTestId('matrix-slot-summary')).toContainText('Slot 1: 1/14');
  await confirmedUpgrade(member.childIds[0]!,2);
  await expect(tree.locator('[data-path="1"]')).toHaveAttribute('data-member-id',member.children[0]!,{timeout:25000});
  await expect(tree.locator('[data-path="0"]')).toHaveAttribute('data-member-id',member.children[2]!);
  await catalog.getByRole('button',{name:'Back to all slots'}).click();
  await catalog.getByRole('combobox',{name:'Filter slots by level'}).click();
  await page.getByRole('option',{name:'Level 4',exact:true}).click();
  await catalog.locator('[data-testid="matrix-slot-card"][data-level="4"][data-cycle="0"]').click();
  await expect(page.locator('.slot-lock-note')).toContainText('Purchase level 4');
  await expect(tree.getByTestId('matrix-slot-summary')).toContainText('0/14');
  expect((await (await page.request.get('/api/referrals/program')).json()).currentLevel).toBe(3);
  await page.getByRole('button',{name:'Unilevel',exact:true}).click();
  await expect(tree.getByRole('button',{name:'Level 15: 0 members',exact:true})).toBeVisible();
  await expect(tree.getByRole('button',{name:'Binary matrix',exact:true})).toHaveCount(0);
  await tree.getByRole('combobox',{name:'Explore the 15 purchase levels'}).click();
  await page.getByRole('option',{name:/^level 2$/i}).click();
  await expect(tree.locator('[data-path="0"]')).toHaveAttribute('data-member-id',member.children[2]!);
  await expect(tree.locator('[data-path="1"]')).toHaveAttribute('data-member-id',member.children[0]!);
  await page.getByRole('button',{name:'List view',exact:true}).click();
  await expect(page.locator('.member-panel tbody tr')).toHaveCount(15);
  await page.getByRole('button',{name:'Matrix slots',exact:true}).click();
  await expect(cards).toHaveCount(16);
  await page.getByRole('combobox',{name:'Language',exact:true}).click();
  await page.getByRole('option',{name:'ไทย',exact:true}).click();
  await expect(page.getByRole('heading',{name:thai.matrixSlots.title,exact:true})).toBeVisible();
  await catalog.getByRole('combobox',{name:thai.matrixSlots.filterLevel}).click();
  await page.getByRole('option',{name:thai.matrixSlots.level.replace('{level}','1'),exact:true}).click();
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText(thai.matrixSlots.completed);
  await expect(cards.nth(1)).toContainText(thai.matrix.rebirthNumber.replace('{number}','1'));
  await catalog.screenshot({path:info.outputPath('matrix-slots-th.png')});
  await cards.nth(1).click();
  await expect(page.locator('.slot-detail-heading')).toContainText(thai.matrix.rebirthNumber.replace('{number}','1'));
  await expect(tree.locator(`[data-member-id="${member.children[14]}"]`)).toContainText(thai.publicTree.notPurchased);
  await page.getByRole('button',{name:thai.ui.use_dark_theme,exact:true}).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await catalog.getByRole('button',{name:thai.matrixSlots.back,exact:true}).click();
  await catalog.screenshot({path:info.outputPath('matrix-slots-th-dark.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await catalog.innerText()).not.toContain('????');
  expect(errors).toEqual([]);
});

test("unilevel level and rebirth selectors show each slot's own branch",async({page})=>{
  const member=await fixture(1),database=openTestDatabase();
  await confirmedUpgrade(member.childIds[2]!,2);
  try {
    // Import a completed cycle, just as the matrix browsing fixtures do.
    await database.execute("UPDATE unilevel_slots SET completed_at=$1 WHERE user_id=$2 AND level=2 AND cycle=0",new Date().toISOString(),member.owner);
    await database.execute("SELECT place_program_slot($1,2,'unilevel',1)",member.owner);
    await database.execute("UPDATE unilevel_slots SET rebirth_paid=TRUE,unlocked=TRUE WHERE user_id=$1 AND level=2 AND cycle=1",member.owner);
  } finally {await database.close();}
  await confirmedUpgrade(member.childIds[0]!,2);
  const initial=await (await page.request.get(`/api/referrals/tree?id=${member.memberId}&mode=unilevel&level=2&cycle=0`)).json();
  const reborn=await (await page.request.get(`/api/referrals/tree?id=${member.memberId}&mode=unilevel&level=2&cycle=1`)).json();
  expect(initial.members.map((row:{id:string})=>row.id)).toEqual([member.memberId,member.children[2]]);
  expect(reborn.members.map((row:{id:string})=>row.id)).toEqual([member.memberId,member.children[0]]);
  expect(reborn.cycles).toEqual([0,1]); expect(reborn.maxDepth).toBe(15);
  expect((await page.request.get(`/api/referrals/tree?id=${member.memberId}&mode=unilevel&level=2&cycle=2`)).status()).toBe(404);
  expect((await page.request.post('/api/auth/login',{headers:{Origin:origin},data:{memberId:member.memberId,password}})).status()).toBe(200);
  await page.goto('/referrals');
  await page.getByRole('button',{name:'Unilevel',exact:true}).click();
  const tree=page.getByTestId('binary-referral-tree');
  await tree.getByRole('combobox',{name:'Explore the 15 purchase levels'}).click();
  await page.getByRole('option',{name:/^level 2$/i}).click();
  await expect(tree.locator('[data-path="0"]')).toHaveAttribute('data-member-id',member.children[2]!);
  await tree.getByRole('combobox',{name:'Program slot',exact:true}).click();
  await page.getByRole('option',{name:'Reborn 1',exact:true}).click();
  await expect(tree.locator('[data-path="0"]')).toHaveAttribute('data-member-id',member.children[0]!);
  await expect(tree.locator(`[data-member-id="${member.children[2]}"]`)).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
