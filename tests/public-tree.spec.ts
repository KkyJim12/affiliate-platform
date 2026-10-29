import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../server/lib/password';
import { openTestDatabase } from './database';
import thai from '../i18n/locales/th.json' with { type: 'json' };
import { treePathDepth } from '../shared/referral-tree';

const origin = 'http://127.0.0.1:3100';
const password = 'Public referral tree testing 42!';
const emptyPath = (depth: number, slot = '0') => Array(depth).fill(slot).join('/');
const post = (api: APIRequestContext, path: string, data: object) => api.post(path, { headers: { Origin: origin }, data });
const openInitialSlot = (page: Page) => page.locator('[data-testid="matrix-slot-card"][data-level="1"][data-cycle="0"]').click();

async function fixture(activated = false) {
  const db = openTestDatabase(), id = randomUUID(), username = `tree_${id.slice(0, 8)}`;
  const legacyCode = `UNXO-${id.slice(0, 8).toUpperCase()}`;
  try {
    const user = await db.one('INSERT INTO users VALUES ($1,$2,$3,$4,NULL,$5) RETURNING referral_code', id, username, await hashPassword(password), legacyCode, new Date().toISOString());
    const wallet = `LW-${id}`;
    await db.execute('INSERT INTO wallets (id,user_id,available) VALUES ($1,$2,20000000)', wallet, id);
    if (activated) {
      const purchase = randomUUID();
      await db.execute("INSERT INTO wallet_transactions (id,wallet_id,type,amount,status,description,request_key,created_at) VALUES ($1,$2,'referral_purchase',10000000,'completed','Fixture activation',$3,$4)", purchase, wallet, randomUUID(), new Date().toISOString());
      await db.execute('INSERT INTO referral_activations (user_id,transaction_id,created_at) VALUES ($1,$2,$3)', id, purchase, new Date().toISOString());
    }
    return { id, username, memberId: user!.referral_code as string, legacyCode };
  } finally { await db.close(); }
}

async function slotFixture() {
  const root=await fixture(true),db=openTestDatabase(),children:{id:string;memberId:string}[]=[];
  try {
    for(let index=0;index<15;index++) {
      const id=randomUUID();
      const row=await db.one("INSERT INTO users VALUES($1,$2,'hash',$1,$3,$4) RETURNING referral_code",id,`public_slot_${id.slice(0,8)}`,root.id,new Date().toISOString());
      children.push({id,memberId:row!.referral_code});
    }
    await db.execute("UPDATE matrix_slots SET unlocked=TRUE WHERE level=1 AND user_id=ANY($1::TEXT[])",children.slice(0,14).map(child=>child.id));
    await db.execute("UPDATE matrix_slots SET completed_at=$1 WHERE user_id=$2 AND level=1 AND cycle=0",new Date().toISOString(),root.id);
    await db.execute("UPDATE matrix_slots SET opened=TRUE,rebirth_paid=TRUE,unlocked=TRUE WHERE user_id=$1 AND level=1 AND cycle=1",root.id);
    return {...root,children};
  } finally {await db.close();}
}

test('public slot catalogs show the requested member, validate pagination, and keep account data private',async({request},info)=>{
  test.skip(info.project.name!=='desktop');
  const root=await slotFixture(),other=await fixture(),db=openTestDatabase();
  try {
    expect((await request.get('/api/referrals/slots')).status()).toBe(401);
    const response=await request.get(`/api/referrals/public-slots?id=${root.memberId}`);
    expect(response.status()).toBe(200);
    const catalog=await response.json();
    expect(catalog.memberId).toBe(root.memberId); expect(catalog.total).toBe(16);
    expect(catalog.items).toHaveLength(16);
    const level=await (await request.get(`/api/referrals/public-slots?id=${root.memberId}&level=1`)).json();
    expect(level.items).toEqual([
      {level:1,cycle:0,status:'completed',filled:14,paid:14,capacity:14},
      {level:1,cycle:1,status:'open',filled:1,paid:0,capacity:14},
    ]);
    for(const secret of [root.id,root.username,root.children[0]!.id,'wallet','amount','password','user_id','created_at']) expect(await response.text()).not.toContain(secret);
    for(const id of ['',root.id,'0','-1','1.5','01','not-a-member']) expect((await request.get(`/api/referrals/public-slots?id=${id}`)).status()).toBe(400);
    expect((await request.get('/api/referrals/public-slots?id=9007199254740991')).status()).toBe(404);
    for(const query of ['page=0','page=1.5','page=1000001','level=-1','level=16'])
      expect((await request.get(`/api/referrals/public-slots?id=${root.memberId}&${query}`)).status()).toBe(400);
    expect((await post(request,'/api/auth/login',{memberId:other.memberId,password})).status()).toBe(200);
    expect((await (await request.get(`/api/referrals/slots?id=${root.memberId}`)).json()).memberId).toBe(other.memberId);
    expect((await (await request.get(`/api/referrals/public-slots?id=${root.memberId}`)).json()).memberId).toBe(root.memberId);
    const now=new Date().toISOString();
    await db.execute("UPDATE matrix_slots SET completed_at=$1 WHERE user_id=$2 AND level=1 AND cycle=1",now,root.id);
    for(let cycle=2;cycle<=12;cycle++) await db.execute(`INSERT INTO matrix_slots(id,user_id,level,cycle,unlocked,completed_at,created_at,rebirth_paid)
      VALUES($1,$2,1,$3,TRUE,$4,$4,TRUE)`,`matrix:1:${root.id}:${cycle}`,root.id,cycle,now);
    await db.execute("INSERT INTO matrix_slots(id,user_id,level,cycle,unlocked,created_at) VALUES($1,$2,1,14,TRUE,$3)",`matrix:1:${root.id}:14`,root.id,now);
    const first=await (await request.get(`/api/referrals/public-slots?id=${root.memberId}`)).json();
    const second=await (await request.get(`/api/referrals/public-slots?id=${root.memberId}&page=2`)).json();
    expect(first.items).toHaveLength(24); expect(second.items).toHaveLength(3); expect(first.total).toBe(27);
    expect([...first.items,...second.items].some((slot:{cycle:number})=>slot.cycle===14)).toBe(false);
    expect((await db.one('SELECT available FROM wallets WHERE user_id=$1',root.id))!.available).toBe(20000000);
  } finally {await db.close();}
});

test('ID search opens the selected member’s level and rebirth cards and resets when searching another ID',async({page},info)=>{
  const root=await slotFixture(),other=await fixture(),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`/search?id=${root.memberId}`);
  const catalog=page.getByTestId('matrix-slots'),tree=page.getByTestId('binary-referral-tree'),cards=catalog.getByTestId('matrix-slot-card');
  await expect(page.getByRole('heading',{name:`Member ID ${root.memberId}`,exact:true})).toBeVisible();
  await expect(cards).toHaveCount(16); await expect(tree).toHaveCount(0);
  const filter=catalog.getByRole('combobox',{name:'Filter slots by level'});
  const chooseLevel=async(level:number)=>{await filter.press('Home');for(let step=0;step<level;step++) await filter.press('ArrowDown');await filter.press('Enter');};
  await chooseLevel(1); await expect(cards).toHaveCount(2);
  await openInitialSlot(page);
  await expect(tree.locator('[data-path=""]')).toHaveAttribute('data-member-id',root.memberId);
  await expect(tree.locator('[data-member-id]')).toHaveCount(15);
  await expect(tree.getByTestId('matrix-slot-summary')).toContainText('14/14');
  await catalog.getByRole('button',{name:'Back to all slots',exact:true}).click();
  await catalog.locator('[data-testid="matrix-slot-card"][data-cycle="1"]').click();
  await expect(tree.locator('[data-member-id]')).toHaveCount(2);
  await expect(tree.locator('[data-path="0"]')).toHaveAttribute('data-member-id',root.children[14]!.memberId);
  await catalog.getByRole('button',{name:'Back to all slots',exact:true}).click();
  await chooseLevel(2); await cards.first().click();
  await expect(catalog.locator('.slot-lock-note')).toContainText(`Member ID ${root.memberId} has not purchased level 2`);
  await expect(page.getByRole('button',{name:/purchase|activate|upgrade/i})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('public-member-slot.png'),fullPage:true});
  await page.getByLabel('Member ID',{exact:true}).fill(other.memberId);
  await page.getByRole('button',{name:'Search tree',exact:true}).click();
  await expect(cards).toHaveCount(15); await expect(tree).toHaveCount(0);
  await expect(filter).toContainText('All levels');
  await openInitialSlot(page);
  await expect(tree.locator('[data-path=""]')).toHaveAttribute('data-member-id',other.memberId);
  await expect(tree.locator(`[data-member-id="${root.memberId}"]`)).toHaveCount(0);
  await page.getByLabel('Member ID',{exact:true}).fill('9007199254740991');
  await page.getByRole('button',{name:'Search tree',exact:true}).click();
  await expect(catalog.getByRole('alert')).toHaveText('No member was found with that ID.');
  await expect(cards).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('public ID lookup has empty positions through level 15 and exposes IDs, structure and purchase state', async ({ request }, info) => {
  test.skip(info.project.name !== 'desktop');
  const root = await fixture();
  const response = await request.get(`/api/referrals/tree?id=${root.memberId}`);
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.root).toEqual({ id: root.memberId, path: '', parentId: null, purchased: false });
  expect(result.members).toEqual([result.root]);
  expect(result.visibleDepth).toBe(3);
  expect(result.levels).toHaveLength(15);
  expect(result.levels[0]).toEqual({ depth: 1, filled: 0 });
  expect(result.levels[14]).toEqual({ depth: 15, filled: 0 });
  for (const secret of [root.id, root.username, 'username', 'password', 'sponsor_id', 'wallet', 'created_at']) expect(await response.text()).not.toContain(secret);
  const deep = await (await request.get(`/api/referrals/tree?id=${root.memberId}&path=${emptyPath(12)}`)).json();
  expect(deep.visibleDepth).toBe(3);
  expect(deep.members).toEqual([]);
  for (const path of [emptyPath(16), '0//1', '-1', '01', '0/1.5', 'invalid'])
    expect((await request.get(`/api/referrals/tree?id=${root.memberId}&path=${path}`)).status()).toBe(400);
  expect((await request.get(`/api/referrals/tree?id=${root.memberId}&path=10&levels=15`)).status()).toBe(400);
  for (const levels of [6, 10, 15]) {
    const response = await request.get(`/api/referrals/tree?id=${root.memberId}&levels=${levels}`);
    expect(response.status()).toBe(200);
    expect((await response.json()).visibleDepth).toBe(levels);
  }
  for (const levels of [0, 16, 1.5, 'invalid']) expect((await request.get(`/api/referrals/tree?id=${root.memberId}&levels=${levels}`)).status()).toBe(400);
  for (const id of ['0', '-1', '1.5', 'UNXO-12345678', '9007199254740992']) expect((await request.get(`/api/referrals/tree?id=${id}`)).status()).toBe(400);
  expect((await request.get('/api/referrals/tree?id=9007199254740991')).status()).toBe(404);
  const db = openTestDatabase();
  try {
    let parent = root.id;
    for (let depth = 1; depth <= 16; depth++) {
      const id = randomUUID();
      await db.execute('INSERT INTO users VALUES ($1,$2,\'private-hash\',$1,$3,$4)', id, `depth${depth}_${id.slice(0, 8)}`, parent, new Date().toISOString());
      parent = id;
    }
    const filled = await (await request.get(`/api/referrals/tree?id=${root.memberId}&path=${emptyPath(12)}&levels=5`)).json();
    expect(filled.visibleDepth).toBe(3);
    expect(filled.members.map((member: { path: string }) => treePathDepth(member.path))).toEqual([12, 13, 14, 15]);
    expect(filled.levels[14].filled).toBe(1);
    const full = await (await request.get(`/api/referrals/tree?id=${root.memberId}&levels=15`)).json();
    expect(full.members.map((member: { path: string }) => treePathDepth(member.path))).toEqual(Array.from({ length: 16 }, (_, index) => index));
  } finally { await db.close(); }
});

test('registration via numeric and old invite codes shows payment tags and updates them after purchase', async ({ playwright, page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const root = await fixture(true);
  const db = openTestDatabase();
  const clients = await Promise.all(Array.from({ length: 4 }, () => playwright.request.newContext({ baseURL: origin })));
  try {
    // This fixture makes four real registrations against the shared disposable
    // server. Isolate its throttle state from other browser scenarios.
    await db.execute('DELETE FROM rate_limits');
    const users = [];
    for (const [index, api] of clients.entries()) {
      const response = await post(api, '/api/auth/register', { username: `child_${randomUUID().slice(0, 8)}`, password, sponsorCode: index === 3 ? root.legacyCode.replace('UNXO-', 'LOOP-') : root.memberId });
      expect(response.status(), await response.text()).toBe(201);
      const { user } = await response.json();
      expect(user.sponsorCode).toBe(root.memberId);
      expect(user.referralCode).toBeNull();
      users.push(user);
    }
    expect(users.map(user => Number(user.memberId))).toEqual([1, 2, 3, 4].map(offset => Number(root.memberId) + offset));
    const tree = await (await clients[0]!.get(`/api/referrals/tree?id=${root.memberId}`)).json();
    expect(tree.members.map((member: { path: string }) => member.path)).toEqual(['', '0', '1', '0/0', '0/1']);
    expect(tree.members.slice(1).map((member: { id: string }) => member.id)).toEqual(users.map(user => user.memberId));
    expect(tree.members.slice(1).map((member: { parentId: string }) => member.parentId)).toEqual([root.memberId,root.memberId,users[0].memberId,users[0].memberId]);
    expect(tree.root.purchased).toBe(true);
    expect(tree.members.slice(1).every((member: { purchased: boolean }) => !member.purchased)).toBe(true);
    const matrix = await (await clients[0]!.get(`/api/referrals/tree?id=${root.memberId}&mode=matrix`)).json();
    expect(matrix.members).toEqual(tree.members);
    expect(matrix.levels.map((row: { filled: number }) => row.filled)).toEqual([0, 0, 0]);
    expect(tree.levels[0].filled).toBe(2);
    expect(tree.levels[1].filled).toBe(2);
    expect((await db.one('SELECT sponsor_id FROM users WHERE id = $1', users[2].id))!.sponsor_id).toBe(root.id);
    await page.goto(`/search?id=${root.memberId}`);
    await openInitialSlot(page);
    const visibleTree = page.getByTestId('binary-referral-tree');
    await expect(visibleTree.getByTestId('not-purchased-tag')).toHaveCount(4);
    await expect(visibleTree.locator(`[data-member-id="${users[0].memberId}"]`)).toContainText('Unpaid');
    await expect(visibleTree.getByTestId('paid-tag')).toHaveCount(1);
    await expect(visibleTree.locator(`[data-member-id="${root.memberId}"]`).getByTestId('paid-tag')).toHaveText('Paid');
    await expect(visibleTree.locator('[data-empty="true"] .binary-tree-purchase-tag')).toHaveCount(0);
    await page.getByRole('button', { name: 'Unilevel', exact: true }).click();
    await expect(visibleTree.getByTestId('not-purchased-tag')).toHaveCount(4);
    await expect(visibleTree.getByTestId('paid-tag')).toHaveCount(1);
    await db.execute('UPDATE wallets SET available = 10000000 WHERE user_id = $1', users[0].id);
    const activated = await post(clients[0]!, '/api/referrals/activate', { password, requestKey: randomUUID() });
    expect(activated.status()).toBe(200);
    expect((await activated.json()).program.code).toBe(users[0].memberId);
    for (const mode of ['matrix', 'unilevel']) {
      const purchased = await (await clients[0]!.get(`/api/referrals/tree?id=${root.memberId}&mode=${mode}`)).json();
      expect(purchased.members).toEqual(tree.members.map((member: { id: string; purchased: boolean }) => ({ ...member, purchased: member.purchased || member.id === users[0].memberId })));
    }
    await page.reload();
    await openInitialSlot(page);
    await expect(visibleTree.getByTestId('not-purchased-tag')).toHaveCount(3);
    await expect(visibleTree.getByTestId('paid-tag')).toHaveCount(2);
    await expect(visibleTree.locator(`[data-member-id="${users[0].memberId}"]`).getByTestId('paid-tag')).toHaveText('Paid');
    await expect(visibleTree.locator(`[data-member-id="${users[0].memberId}"]`).getByTestId('not-purchased-tag')).toHaveCount(0);
  } finally { await db.execute('DELETE FROM rate_limits'); await db.close(); await Promise.all(clients.map(api => api.dispose())); }
});

test('extra referrals spill under the first referral in both tree views', async ({ page }) => {
  const root=await fixture(),db=openTestDatabase();
  const children: {id:string;memberId:string}[]=[];
  try {
    for(let i=0;i<3;i++) {
      const id=randomUUID();
      const inserted=await db.one("INSERT INTO users VALUES($1,$2,'hash',$1,$3,$4) RETURNING referral_code",id,`binary_${id.slice(0,8)}`,root.id,new Date().toISOString());
      children.push({id,memberId:inserted!.referral_code});
      await db.execute("UPDATE matrix_slots SET unlocked=TRUE WHERE user_id=$1 AND level=1",id);
    }
    const result=await (await page.request.get(`/api/referrals/tree?id=${root.memberId}`)).json();
    expect(result.members.map((m:{path:string})=>m.path)).toEqual(['','0','1','0/0']);
    expect(result.members[3].parentId).toBe(children[0].memberId);
    await page.goto(`/search?id=${root.memberId}`);
    await openInitialSlot(page);
    const tree=page.getByTestId('binary-referral-tree');
    await expect(tree.locator('[data-tree-edge][data-parent-path=""]')).toHaveCount(2);
    await expect(tree.locator('[data-path="0/0"]')).toHaveAttribute('data-member-id',children[2].memberId);
    await page.getByRole('button',{name:'Unilevel',exact:true}).click();
    await expect(tree.getByRole('button',{name:'Level 15: 0 members',exact:true})).toBeVisible();
    await expect(tree.locator('[data-path="0/0"]')).toHaveAttribute('data-member-id',children[2].memberId);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally {await db.close();}
});

test('any visitor can search by ID and explore empty boxes through 15 levels on desktop and mobile', async ({ page }, info) => {
  const root = await fixture();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning' && /i18n|hydration/i.test(message.text())) errors.push(message.text()); });
  await page.goto('/search');
  await expect(page.getByRole('heading', { name: 'Find your referral tree.', exact: true })).toBeVisible();
  await page.getByLabel('Member ID', { exact: true }).fill(root.memberId);
  await page.getByRole('button', { name: 'Search tree', exact: true }).click();
  await expect(page.getByTestId('matrix-slot-card')).toHaveCount(15);
  await expect(page.getByTestId('binary-referral-tree')).toHaveCount(0);
  await openInitialSlot(page);
  const tree = page.getByTestId('binary-referral-tree');
  await expect(tree.locator('[data-tree-node]')).toHaveCount(15);
  await expect(tree.locator('[data-empty="true"]')).toHaveCount(14);
  await page.getByRole('button',{name:'Unilevel',exact:true}).click();
  await tree.getByRole('combobox', { name: 'Visible levels', exact: true }).click();
  await page.getByRole('listbox').locator('[data-value="15"]').click();
  await expect(tree).toContainText('Showing levels 0–15 of 15');
  await expect(tree.getByRole('combobox', { name: 'Visible levels', exact: true })).toContainText('15 levels at a time');
  expect(await tree.locator('[data-tree-node]').count()).toBeLessThan(250);
  const viewport = tree.locator('.binary-tree-viewport');
  await viewport.evaluate(element => { element.scrollLeft = element.scrollWidth - element.clientWidth; element.scrollTop = element.scrollHeight; });
  const lastPosition = tree.locator(`[data-path="${emptyPath(15, '1')}"]`);
  await expect(lastPosition).toBeVisible();
  await expect(lastPosition).not.toHaveAttribute('role', 'button');
  await viewport.evaluate(element => { element.scrollLeft = 0; });
  await expect(tree.locator(`[data-path="${emptyPath(15)}"]`)).toBeVisible();
  expect(await tree.locator('[data-tree-node]').count()).toBeLessThan(250);
  await tree.getByRole('button', { name: 'Level 1: 0 members', exact: true }).click();
  await expect(tree.locator('[data-member-id]')).toHaveAttribute('data-member-id', root.memberId);
  await expect(tree).toContainText('ID ' + root.memberId);
  await tree.getByRole('combobox', { name: 'Visible levels', exact: true }).click();
  await page.getByRole('listbox').locator('[data-value="3"]').click();
  await expect(tree.locator('[data-tree-node]')).toHaveCount(15);
  await expect(tree.locator('[data-empty="true"]')).toHaveCount(14);
  await tree.getByRole('button', { name: 'Level 15: 0 members', exact: true }).click();
  await expect(tree).toContainText('Showing levels 12–15 of 15');
  await expect(tree.locator('[data-tree-node]')).toHaveCount(15);
  await expect(tree.locator('[data-empty="true"]')).toHaveCount(15);
  await tree.getByRole('button', { name: 'Root', exact: true }).click();
  await expect(tree.locator('[data-member-id]')).toHaveCount(1);
  await expect(tree).toContainText('Showing levels 0–3 of 15');
  await page.reload();
  await page.getByRole('button',{name:'Unilevel',exact:true}).click();
  await expect(tree.locator('[data-member-id]')).toHaveAttribute('data-member-id', root.memberId);
  await expect(tree).toContainText('Showing levels 0–3 of 15');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('combobox', { name: 'Language', exact: true }).click();
  await page.getByRole('listbox').locator('[data-value="th"]').click();
  await expect(page.getByRole('heading', { name: thai.publicTree.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: thai.matrixSlots.nav, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: thai.matrix.unilevel, exact: true })).toBeVisible();
  await expect(tree).not.toContainText(/\?{2,}|\uFFFD/u);
  await page.getByRole('button', { name: thai.matrixSlots.nav, exact: true }).click();
  await openInitialSlot(page);
  await expect(tree).toContainText(thai.matrix.treeHint);
  await page.getByRole('button', { name: thai.ui.use_dark_theme, exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('.public-tree-result')).toHaveCSS('background-color', 'rgb(21, 26, 35)');
  await page.screenshot({ path: `test-results/public-tree-${info.project.name}.png`, fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/faq/ranks');
  await expect(page.getByTestId('referral-ranks')).toContainText('คอมมิชชันไบนารีแมทริกซ์');
  await expect(page.getByTestId('referral-ranks')).toContainText('ผู้รับต้องมีบัญชีที่ใช้งานได้');
  await expect(page.locator('body')).not.toContainText(/\?{2,}|\uFFFD/u);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/thai-ranks-encoding-${info.project.name}.png`, fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});
