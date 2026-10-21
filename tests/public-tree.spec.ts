import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../server/lib/password';
import { openTestDatabase } from './database';
import thai from '../i18n/locales/th.json' with { type: 'json' };
import { treePathDepth } from '../shared/referral-tree';

const origin = 'http://127.0.0.1:3100';
const password = 'Public referral tree testing 42!';
const emptyPath = (depth: number, slot = '0') => Array(depth).fill(slot).join('/');
const post = (api: APIRequestContext, path: string, data: object) => api.post(path, { headers: { Origin: origin }, data });

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

test('public ID lookup has empty positions through level 15 and exposes only IDs, usernames and structure', async ({ request }, info) => {
  test.skip(info.project.name !== 'desktop');
  const root = await fixture();
  const response = await request.get(`/api/referrals/tree?id=${root.memberId}`);
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.root).toEqual({ id: root.memberId, username: root.username, path: '', parentId: null });
  expect(result.members).toEqual([result.root]);
  expect(result.visibleDepth).toBe(3);
  expect(result.levels).toHaveLength(15);
  expect(result.levels[0]).toEqual({ depth: 1, filled: 0 });
  expect(result.levels[14]).toEqual({ depth: 15, filled: 0 });
  for (const secret of [root.id, 'password', 'sponsor_id', 'wallet', 'created_at']) expect(await response.text()).not.toContain(secret);
  const deep = await (await request.get(`/api/referrals/tree?id=${root.memberId}&path=${emptyPath(12)}`)).json();
  expect(deep.visibleDepth).toBe(3);
  expect(deep.members).toEqual([]);
  for (const path of [emptyPath(16), '0//1', '-1', '01', '0/1.5', 'invalid'])
    expect((await request.get(`/api/referrals/tree?id=${root.memberId}&path=${path}`)).status()).toBe(400);
  const multiDigit = await (await request.get(`/api/referrals/tree?id=${root.memberId}&path=10&levels=15`)).json();
  expect(multiDigit.visibleDepth).toBe(14);
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

test('registration via numeric and old invite codes retains every direct referral under their actual sponsor', async ({ playwright }, info) => {
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
    expect(tree.members.map((member: { path: string }) => member.path)).toEqual(['', '0', '1', '2', '3']);
    expect(tree.members.slice(1).map((member: { id: string }) => member.id)).toEqual(users.map(user => user.memberId));
    expect(tree.members.slice(1).map((member: { parentId: string }) => member.parentId)).toEqual(users.map(() => root.memberId));
    expect(tree.levels[0].filled).toBe(4);
    expect(tree.levels[1].filled).toBe(0);
    expect((await db.one('SELECT sponsor_id FROM users WHERE id = $1', users[2].id))!.sponsor_id).toBe(root.id);
    await db.execute('UPDATE wallets SET available = 10000000 WHERE user_id = $1', users[0].id);
    const activated = await post(clients[0]!, '/api/referrals/activate', { password, requestKey: randomUUID() });
    expect(activated.status()).toBe(200);
    expect((await activated.json()).program.code).toBe(users[0].memberId);
  } finally { await db.execute('DELETE FROM rate_limits'); await db.close(); await Promise.all(clients.map(api => api.dispose())); }
});

test('three real branches connect to their sponsor at both the root and nested levels', async ({ page }, info) => {
  const root = await fixture();
  const db = openTestDatabase();
  const children: { id: string; memberId: string; username: string }[] = [];
  try {
    for (let index = 0; index < 6; index++) {
      const id = randomUUID(), username = `w_${id.replaceAll('-', '').slice(0, 18)}`;
      const parent = index < 3 ? root.id : children[2]!.id;
      const inserted = await db.one('INSERT INTO users VALUES ($1,$2,\'private-hash\',$1,$3,$4) RETURNING referral_code',
        id, username, parent, new Date(Date.now() + index * 1000).toISOString());
      children.push({ id, memberId: inserted!.referral_code, username });
    }
    const treeData = await (await page.request.get(`/api/referrals/tree?id=${root.memberId}`)).json();
    expect(treeData.members.map((member: { path: string }) => member.path)).toEqual(['', '0', '1', '2', '2/0', '2/1', '2/2']);
    expect(treeData.members.slice(1).map((member: { parentId: string }) => member.parentId))
      .toEqual([root.memberId, root.memberId, root.memberId, ...Array(3).fill(children[2]!.memberId)]);
    expect(treeData.levels.slice(0, 2).map((level: { filled: number }) => level.filled)).toEqual([3, 3]);
    const branch = await (await page.request.get(`/api/referrals/tree?id=${root.memberId}&path=2`)).json();
    expect(branch.members.map((member: { path: string }) => member.path)).toEqual(['2', '2/0', '2/1', '2/2']);

    await page.goto(`/search?id=${root.memberId}`);
    const tree = page.getByTestId('binary-referral-tree');
    await expect(tree.locator('[data-tree-edge][data-parent-path=""]')).toHaveCount(3);
    await expect(tree.locator('[data-tree-edge][data-parent-path="2"]')).toHaveCount(3);
    for (const [index, child] of children.entries()) {
      const path = index < 3 ? String(index) : `2/${index - 3}`;
      await expect(tree.locator(`[data-path="${path}"]`)).toHaveAttribute('data-member-id', child.memberId);
    }
    const third = tree.locator('[data-path="2"]');
    const siblingRows = await tree.locator('[data-path="0"], [data-path="1"], [data-path="2"]').evaluateAll(elements =>
      elements.map(element => (element as SVGGraphicsElement).transform.baseVal.consolidate()!.matrix.f));
    expect(new Set(siblingRows).size).toBe(1);
    await expect(tree.getByRole('button', { name: 'Level 1: 3 members', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/referral-three-branches-${info.project.name}.png`, fullPage: true, animations: 'disabled' });

    await third.press('Enter');
    await expect(tree).toContainText('Showing levels 1–4 of 15');
    await expect(tree).toContainText('Branch 3');
    await expect(tree.locator('[data-tree-edge][data-parent-path="2"]')).toHaveCount(3);
    await tree.getByRole('button', { name: 'Up one level', exact: true }).click();
    await expect(tree).toContainText('Showing levels 0–3 of 15');
    await expect(tree.locator('[data-tree-edge][data-parent-path=""]')).toHaveCount(3);

    const login = await post(page.request, '/api/auth/login', { username: root.username, password });
    expect(login.status()).toBe(200);
    await page.goto('/referrals');
    await expect(tree.locator('[data-tree-edge][data-parent-path=""]')).toHaveCount(3);
    await expect(tree.locator('[data-tree-edge][data-parent-path="2"]')).toHaveCount(3);
    await expect(tree.locator('[data-path="2"]')).toHaveAttribute('data-member-id', children[2]!.memberId);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto('/dashboard');
    const overview = page.getByTestId('overview-referral-tree');
    await expect(overview.locator('[data-tree-edge][data-parent-path=""]')).toHaveCount(3);
    await expect(overview.locator('[data-tree-edge][data-parent-path="2"]')).toHaveCount(3);
  } finally { await db.close(); }
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
  const tree = page.getByTestId('binary-referral-tree');
  await expect(tree.locator('[data-tree-node]')).toHaveCount(15);
  await expect(tree.locator('[data-empty="true"]')).toHaveCount(14);
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
  await expect(tree).toContainText('@' + root.username);
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
  await expect(tree.locator('[data-member-id]')).toHaveAttribute('data-member-id', root.memberId);
  await expect(tree).toContainText('Showing levels 0–3 of 15');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('combobox', { name: 'Language', exact: true }).click();
  await page.getByRole('listbox').locator('[data-value="th"]').click();
  await expect(page.getByRole('heading', { name: thai.publicTree.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: thai.ui.use_dark_theme, exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('.public-tree-result')).toHaveCSS('background-color', 'rgb(21, 26, 35)');
  await page.screenshot({ path: `test-results/public-tree-${info.project.name}.png`, fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
