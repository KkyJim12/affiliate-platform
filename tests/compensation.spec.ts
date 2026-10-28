import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../server/lib/password';
import { openTestDatabase } from './database';
import { ledgerScale, levelPrice, purchaseShares, shareRecipientDepth } from '../shared/compensation';

const origin = 'http://127.0.0.1:3100';
const password = 'Referral compensation testing 42!';
const firstAddress = `0x${'12'.repeat(20)}`;
const secondAddress = `0x${'34'.repeat(20)}`;
const post = (api: APIRequestContext, path: string, data: object) => api.post(path, { headers: { Origin: origin }, data });

async function fixture(depth: number, balance = 400000) {
  const db = openTestDatabase(), suffix = randomUUID().slice(0, 8), hash = await hashPassword(password);
  const create = async (name: string, sponsor: string | null, activated: boolean, funds = 0) => {
    const id = randomUUID(), walletId = `LW-${randomUUID()}`, code = `UNXO-${randomUUID().slice(0, 8).toUpperCase()}`, username = `${name}_${suffix}`;
    await db.execute('INSERT INTO users VALUES ($1, $2, $3, $4, $5, $6)', id, username, hash, code, sponsor, new Date().toISOString());
    await db.execute('INSERT INTO wallets (id, user_id, available) VALUES ($1, $2, $3)', walletId, id, funds * ledgerScale);
    if (activated) {
      const transactionId = randomUUID();
      await db.execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'referral_purchase', 10000000, 'completed', 'Historic test activation', $3, $4)", transactionId, walletId, randomUUID(), new Date().toISOString());
      await db.execute('INSERT INTO referral_activations (user_id, transaction_id, created_at) VALUES ($1, $2, $3)', id, transactionId, new Date().toISOString());
    }
    return { id, username, walletId, code: (await db.one('SELECT referral_code FROM users WHERE id = $1', id))!.referral_code as string };
  };
  try {
    const uplines: Awaited<ReturnType<typeof create>>[] = [];
    let sponsor: string | null = null;
    for (let i = depth; i >= 1; i--) {
      const user = await create(`up${i}`, sponsor, true);
      sponsor = user.id;
      uplines.unshift(user);
    }
    const buyer = await create('buyer', sponsor, false, balance);
    const admin = await create('feeadmin', null, false);
    await db.execute("INSERT INTO user_access VALUES ($1, 'admin', 'active')", admin.id);
    return { buyer, uplines, admin };
  } finally { await db.close(); }
}

test('purchases pay qualified uplines, locked higher levels pay the platform, and retries do not duplicate payouts', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(120000);
  const data = await fixture(16), db = openTestDatabase();
  const api = await playwright.request.newContext({ baseURL: origin });
  try {
    await db.execute('UPDATE platform_settings SET fee_recipient_address = $1 WHERE id = 1', firstAddress);
    expect((await post(api, '/api/referrals/upgrade', { password, requestKey: randomUUID(), level: 2 })).status()).toBe(401);
    expect((await api.get('/api/admin/referral-accounting')).status()).toBe(401);
    expect((await post(api, '/api/auth/login', { memberId: data.buyer.code, password })).status()).toBe(200);
    const purchase = await post(api, '/api/referrals/activate', { password, requestKey: randomUUID(), amount: 0, userId: data.uplines[0]!.id });
    expect(purchase.status()).toBe(200);
    const activated = await purchase.json();
    expect(activated.program.currentLevel).toBe(1);
    expect(activated.program.nextPrice).toBe(20);
    expect(activated.program.latestPurchase).toEqual({ level: 1, amount: 10, commissions: 9.5, platformPayable: 0.5 });
    const allocation = await db.all('SELECT a.* FROM referral_allocations a JOIN referral_purchases p ON p.id = a.purchase_id WHERE p.user_id = $1', data.buyer.id);
    expect(allocation).toHaveLength(19);
    expect(allocation.reduce((sum, row) => sum + row.amount, 0)).toBe(10000000);
    expect(allocation.filter(row => row.status === 'credited')).toHaveLength(18);
    for (let index = 0; index < 16; index++) {
      const expected = purchaseShares(1).filter(share => share.depth === index + 1).reduce((sum, share) => sum + share.units, 0);
      expect((await db.one('SELECT available FROM wallets WHERE user_id = $1', data.uplines[index]!.id))!.available).toBe(expected);
    }
    const upgradeBody = { password, requestKey: randomUUID(), level: 2 };
    expect((await api.post('/api/referrals/upgrade', { headers: { Origin: 'https://unrelated.example' }, data: upgradeBody })).status()).toBe(403);
    const retries = await Promise.all([post(api, '/api/referrals/upgrade', upgradeBody), post(api, '/api/referrals/upgrade', upgradeBody)]);
    expect(retries.map(response => response.status())).toEqual([200, 200]);
    expect((await retries[0]!.json()).program.currentLevel).toBe(2);
    expect((await (await api.get('/api/referrals/program')).json()).latestPurchase.platformPayable).toBe(20);
    expect((await db.one("SELECT COUNT(*) AS count FROM referral_allocations a JOIN referral_purchases p ON p.id=a.purchase_id WHERE p.user_id=$1 AND p.level=2 AND a.status='credited'",data.buyer.id))!.count).toBe(0);
    expect((await post(api, '/api/referrals/upgrade', { ...upgradeBody, requestKey: randomUUID() })).status()).toBe(409);
    expect((await post(api, '/api/referrals/upgrade', { ...upgradeBody, level: 3 })).status()).toBe(409);
    expect((await post(api, '/api/referrals/upgrade', { password, requestKey: randomUUID(), level: 4 })).status()).toBe(409);
    expect((await post(api, '/api/referrals/upgrade', { password: 'wrong', requestKey: randomUUID(), level: 3 })).status()).toBe(401);
    for (let level = 3; level <= 15; level++) {
      const response = await post(api, '/api/referrals/upgrade', { password, requestKey: randomUUID(), level });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.program.currentLevel).toBe(level);
      expect(body.program.code).toBe(activated.program.code);
      expect(body.program.nextPrice).toBe(level === 15 ? null : levelPrice(level + 1));
    }
    expect((await post(api, '/api/referrals/upgrade', { password, requestKey: randomUUID(), level: 16 })).status()).toBe(400);
    expect((await db.one('SELECT COUNT(*) AS count FROM referral_purchases WHERE user_id = $1', data.buyer.id))!.count).toBe(15);
    expect((await db.one('SELECT available FROM wallets WHERE user_id = $1', data.buyer.id))!.available).toBe((400000 - 327670) * ledgerScale);
    const totals = await db.one(`SELECT SUM(a.amount) AS allocated FROM referral_allocations a JOIN referral_purchases p ON p.id = a.purchase_id WHERE p.user_id = $1`, data.buyer.id);
    expect(totals!.allocated).toBe(327670 * ledgerScale);
    const explorer = await (await api.get('/api/explorer/transactions?type=referral_purchase')).json();
    expect(explorer.summary.debits).toBe(327670);
  } finally { await api.dispose(); await db.close(); }
});

test('missing and ineligible shares accrue to the configured address and address changes preserve previous allocations', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'desktop');
  const data = await fixture(2, 100), db = openTestDatabase();
  const buyer = await playwright.request.newContext({ baseURL: origin });
  const admin = await playwright.request.newContext({ baseURL: origin });
  try {
    await db.execute('UPDATE platform_settings SET fee_recipient_address = $1 WHERE id = 1', firstAddress);
    await db.execute("INSERT INTO user_access VALUES ($1, 'member', 'suspended')", data.uplines[0]!.id);
    await post(buyer, '/api/auth/login', { memberId: data.buyer.code, password });
    await post(admin, '/api/admin/login', { memberId: data.admin.code, password });
    expect((await buyer.get('/api/admin/referral-accounting')).status()).toBe(403);
    const original = await (await admin.get('/api/admin/settings')).json();
    const save = (address: unknown) => admin.put('/api/admin/settings', { headers: { Origin: origin }, data: { ...original, feeRecipientAddress: address } });
    for (const address of ['not-an-address', `0x${'0'.repeat(40)}`, 123]) expect((await save(address)).status()).toBe(400);
    const first = await post(buyer, '/api/referrals/activate', { password, requestKey: randomUUID() });
    expect(first.status()).toBe(200);
    const eligibleShare = purchaseShares(1).filter(share => shareRecipientDepth(share,[false,true]) === 2).reduce((sum, share) => sum + share.units, 0);
    expect((await first.json()).program.latestPurchase.platformPayable).toBe((10000000 - eligibleShare) / ledgerScale);
    expect((await db.one('SELECT available FROM wallets WHERE user_id = $1', data.uplines[0]!.id))!.available).toBe(0);
    expect((await db.one('SELECT available FROM wallets WHERE user_id = $1', data.uplines[1]!.id))!.available).toBe(eligibleShare);
    expect((await save(secondAddress)).status()).toBe(200);
    expect((await post(buyer, '/api/referrals/upgrade', { password, requestKey: randomUUID(), level: 2 })).status()).toBe(200);
    const rows = await db.all('SELECT level, fee_recipient_address FROM referral_purchases WHERE user_id = $1 ORDER BY level', data.buyer.id);
    expect(rows).toEqual([{ level: 1, fee_recipient_address: firstAddress }, { level: 2, fee_recipient_address: secondAddress }]);
    const report = await (await admin.get('/api/admin/referral-accounting')).json();
    expect(report.payables.map((item: { address: string }) => item.address)).toEqual(expect.arrayContaining([firstAddress, secondAddress]));
    const before = (await (await buyer.get('/api/wallet')).json()).available;
    expect((await save('')).status()).toBe(200);
    expect((await post(buyer, '/api/referrals/upgrade', { password, requestKey: randomUUID(), level: 3 })).status()).toBe(409);
    expect((await (await buyer.get('/api/wallet')).json()).available).toBe(before);
    expect((await db.one('SELECT COUNT(*) AS count FROM referral_purchases WHERE user_id = $1', data.buyer.id))!.count).toBe(2);
  } finally {
    await db.execute('UPDATE platform_settings SET fee_recipient_address = $1 WHERE id = 1', firstAddress);
    await Promise.all([buyer.dispose(), admin.dispose()]); await db.close();
  }
});

test('insufficient credit and conflicting request keys roll back all allocations', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'desktop');
  const data = await fixture(0, 10), db = openTestDatabase();
  const api = await playwright.request.newContext({ baseURL: origin });
  try {
    await db.execute('UPDATE platform_settings SET fee_recipient_address = $1 WHERE id = 1', firstAddress);
    await post(api, '/api/auth/login', { memberId: data.buyer.code, password });
    const key = randomUUID();
    await db.execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'deposit', 1, 'pending', 'Conflicting key', $3, $4)", randomUUID(), data.buyer.walletId, key, new Date().toISOString());
    expect((await post(api, '/api/referrals/activate', { password, requestKey: key })).status()).toBe(409);
    expect((await (await api.get('/api/referrals/program')).json()).currentLevel).toBe(0);
    expect((await post(api, '/api/referrals/activate', { password, requestKey: randomUUID() })).status()).toBe(200);
    const program = await (await api.get('/api/referrals/program')).json();
    expect(program.latestPurchase).toEqual({ level: 1, amount: 10, commissions: 0, platformPayable: 10 });
    expect((await post(api, '/api/referrals/upgrade', { password, requestKey: randomUUID(), level: 2 })).status()).toBe(400);
    expect((await db.one('SELECT COUNT(*) AS count FROM referral_purchases WHERE user_id = $1', data.buyer.id))!.count).toBe(1);
    expect((await db.one('SELECT available FROM wallets WHERE user_id = $1', data.buyer.id))!.available).toBe(0);
  } finally { await api.dispose(); await db.close(); }
});

test('legacy paid activations upgrade without changing the code or repaying historical purchases', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'desktop');
  const data = await fixture(1, 100), db = openTestDatabase();
  const api = await playwright.request.newContext({ baseURL: origin });
  try {
    await db.execute('UPDATE platform_settings SET fee_recipient_address = $1 WHERE id = 1', firstAddress);
    const transactionId = randomUUID();
    await db.execute("INSERT INTO wallet_transactions VALUES ($1, $2, 'referral_purchase', 10000000, 'completed', 'Historic activation', $3, $4)", transactionId, data.buyer.walletId, randomUUID(), new Date().toISOString());
    await db.execute('INSERT INTO referral_activations (user_id, transaction_id, created_at) VALUES ($1, $2, $3)', data.buyer.id, transactionId, new Date().toISOString());
    await post(api, '/api/auth/login', { memberId: data.buyer.code, password });
    const before = await (await api.get('/api/referrals/program')).json();
    expect(before.currentLevel).toBe(1);
    expect(before.latestPurchase).toBeNull();
    expect((await post(api, '/api/referrals/activate', { password, requestKey: randomUUID() })).status()).toBe(200);
    expect((await post(api, '/api/referrals/upgrade', { password, requestKey: randomUUID(), level: 2 })).status()).toBe(200);
    const program = await (await api.get('/api/referrals/program')).json();
    expect(program.currentLevel).toBe(2);
    expect(program.code).toBe(data.buyer.code);
    expect((await db.one('SELECT COUNT(*) AS count FROM referral_purchases WHERE user_id = $1', data.buyer.id))!.count).toBe(1);
    expect((await db.one('SELECT available FROM wallets WHERE user_id = $1', data.buyer.id))!.available).toBe(80 * ledgerScale);
  } finally { await api.dispose(); await db.close(); }
});
