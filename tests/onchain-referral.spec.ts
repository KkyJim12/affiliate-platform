import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Contract, JsonRpcProvider, Wallet, parseEther, toBeHex } from 'ethers';
import { openTestDatabase } from './database';
import { hashPassword } from '../server/lib/password';
import thai from '../i18n/locales/th.json' with { type: 'json' };

const origin = 'http://127.0.0.1:3100';
const password = 'Onchain referral testing password 42!';
test.skip(!process.env.REFERRAL_TEST_OWNER_KEY, 'Run with npm run test:onchain using a disposable local EVM.');
const post = (api: APIRequestContext, path: string, body: object) => api.post(path, { headers: { Origin: origin }, data: body });
const provider = () => new JsonRpcProvider(process.env.NUXT_EVM_RPC_URL, undefined, { cacheTimeout: -1 });
const tokenAbi = ['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)', 'function setZeroFirst(bool)'];

async function register(api: APIRequestContext, sponsorCode = '') {
  const username = `oc_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const response = await post(api, '/api/auth/register', { username, password, sponsorCode });
  expect(response.status()).toBe(201);
  const user = (await response.json()).user;
  const wallet = (await (await api.get('/api/wallet/evm')).json()).wallet;
  return { user, wallet, username };
}
async function fund(address: string, amount = 100n) {
  const rpc = provider();
  try {
    const token = new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!, tokenAbi, await rpc.getSigner(0));
    await (await token.getFunction('mint')(address, amount * 1_000_000n)).wait();
    await rpc.send('hardhat_setBalance', [address, toBeHex(parseEther('100'))]);
  } finally { rpc.destroy(); }
}
async function buy(api: APIRequestContext, level = 1, key = randomUUID()) {
  const state = await (await api.get('/api/referrals/chain/status')).json();
  const response = await post(api, '/api/referrals/chain/purchase', { password, level, requestKey: key, maxGasFee: state.gasBudget });
  expect([200, 202]).toContain(response.status());
  return await response.json();
}
async function confirmed(api: APIRequestContext, id: string) {
  await expect.poll(async () => {
    await api.get('/api/referrals/chain/status');
    const items = await (await api.get('/api/referrals/chain/purchases')).json();
    return items.find((item: { id: string }) => item.id === id)?.status;
  }, { timeout: 30000 }).toBe('confirmed');
}
async function seedOwner() {
  const wallet = new Wallet(process.env.REFERRAL_TEST_OWNER_KEY!);
  const database = openTestDatabase();
  try {
    const existing = await database.one('SELECT u.username FROM users u JOIN evm_wallets e ON e.user_id = u.id WHERE lower(e.address) = lower($1)', wallet.address);
    if (existing) return existing.username as string;
    const id = randomUUID(), username = `ocadmin_${randomUUID().slice(0, 8)}`, timestamp = new Date().toISOString();
    await database.execute('INSERT INTO users VALUES ($1,$2,$3,$4,NULL,$5)', id, username, await hashPassword(password), `UNASSIGNED-${id}`, timestamp);
    await database.execute('INSERT INTO wallets (id,user_id) VALUES ($1,$2)', `LW-${randomUUID()}`, id);
    await database.execute("INSERT INTO user_access VALUES ($1,'admin','active')", id);
    await database.execute('INSERT INTO evm_wallets VALUES ($1,$2,$3,$4,80002,$5)', id, wallet.address, wallet.signingKey.publicKey, await wallet.encrypt(password), timestamp);
    return username;
  } finally { await database.close(); }
}

test('real contract purchases debit tokens, distribute automatically, deduplicate retries and never credit the internal ledger', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(120000);
  const root = await playwright.request.newContext({ baseURL: origin }), member = await playwright.request.newContext({ baseURL: origin });
  const rpc = provider(), database = openTestDatabase();
  try {
    const first = await register(root); await fund(first.wallet.address);
    const initial = await (await root.get('/api/referrals/chain/status')).json();
    expect(initial).toMatchObject({ mode: 'contract', ready: true, balance: '100.0', chainId: 80002 });
    expect((await post(root, '/api/referrals/activate', { password, requestKey: randomUUID() })).status()).toBe(409);
    const invalid = await post(root, '/api/referrals/chain/purchase', { password, level: 1, requestKey: randomUUID(), maxGasFee: '0.0000000001' });
    expect(invalid.status()).toBe(409);
    const key = randomUUID(), purchase = await buy(root, 1, key); await confirmed(root, purchase.id);
    const retry = await buy(root, 1, key); expect(retry.id).toBe(purchase.id);
    const program = await (await root.get('/api/referrals/program')).json();
    expect(program.currentLevel).toBe(1); expect(program.code).toMatch(/^LOOP-/);
    const child = await register(member, program.code); await fund(child.wallet.address);
    const second = await buy(member); await confirmed(member, second.id);
    const token = new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!, tokenAbi, rpc);
    expect(await token.getFunction('balanceOf')(first.wallet.address)).toBe(95_750_023n);
    expect(await token.getFunction('balanceOf')(child.wallet.address)).toBe(90_000_000n);
    const rootWallet = await (await root.get('/api/wallet')).json();
    expect(rootWallet.available).toBe(0); expect(rootWallet.earned).toBe(0);
    expect((await (await root.get('/api/dashboard')).json()).commissions).toBe(5.750023);
    expect((await database.one('SELECT COUNT(*) AS count FROM referral_chain_allocations WHERE purchase_id = $1', second.id))!.count).toBe(19);
    expect((await database.one('SELECT SUM(amount) AS total FROM referral_chain_allocations WHERE purchase_id = $1', second.id))!.total).toBe(10_000_000);
    expect((await database.one('SELECT COUNT(*) AS count FROM referral_chain_purchases WHERE user_id = $1', first.user.id))!.count).toBe(1);
    expect((await root.get('/api/admin/referrals/status')).status()).toBe(403);
    expect((await post(member, '/api/referrals/chain/purchase', { password: 'wrong', level: 2, requestKey: randomUUID(), maxGasFee: initial.gasBudget })).status()).toBe(401);
    const forbidden = await member.post('/api/referrals/chain/purchase', { headers: { Origin: 'https://unrelated.example' }, data: { password, level: 2, requestKey: randomUUID(), maxGasFee: initial.gasBudget } });
    expect(forbidden.status()).toBe(403);
  } finally { await Promise.all([root.dispose(), member.dispose()]); rpc.destroy(); await database.close(); }
});

test('pending signed transactions recover without an open browser and activation waits for the receipt', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(90000);
  const api = await playwright.request.newContext({ baseURL: origin }), rpc = provider(), database = openTestDatabase();
  try {
    const account = await register(api); await fund(account.wallet.address);
    await rpc.send('evm_setAutomine', [false]);
    const purchase = await buy(api);
    expect(purchase.status).toBe('pending');
    expect((await (await api.get('/api/referrals/program')).json()).code).toBeNull();
    const outbox = await database.all('SELECT stage,raw_transaction FROM referral_chain_transactions WHERE operation_id = $1 ORDER BY nonce', purchase.id);
    expect(outbox.map(row => row.stage)).toEqual(['approval', 'purchase']);
    expect(outbox.every(row => /^0x[0-9a-f]+$/i.test(row.raw_transaction))).toBe(true);
    await api.dispose();
    await rpc.send('evm_mine', []);
    await expect.poll(async () => (await database.one('SELECT status FROM referral_chain_purchases WHERE id = $1', purchase.id))?.status,
      { timeout: 45000, intervals: [1000, 3000, 5000] }).toBe('confirmed');
    expect((await database.one('SELECT user_id FROM referral_activations WHERE user_id = $1', account.user.id))!.user_id).toBe(account.user.id);
  } finally { await rpc.send('evm_setAutomine', [true]); await api.dispose(); rpc.destroy(); await database.close(); }
});

test('members buy and upgrade on-chain with English/Thai and responsive layouts', async ({ page }, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const account = await register(page.request); await fund(account.wallet.address);
  const rpc = provider();
  try { await rpc.send('hardhat_setBalance', [account.wallet.address, toBeHex(parseEther('0.000001'))]); }
  finally { rpc.destroy(); }
  await page.goto('/referrals');
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: unknown })?.__vue_app__));
  await expect(page.getByTestId('chain-token-balance')).toContainText('100.00');
  const purchaseButton = page.getByRole('button', { name: 'Buy level 1 · 10.00 tUSDT', exact: true });
  await expect(purchaseButton).toBeDisabled();
  await expect(page.getByTestId('chain-gas-balance')).toHaveText('0.000001 POL');
  await expect(page.getByTestId('chain-gas-budget')).toContainText('POL');
  await expect(page.getByTestId('chain-insufficient-gas')).toContainText('Your balance is 0.000001 POL');
  await expect(page.getByTestId('chain-insufficient-token')).toHaveCount(0);
  await fund(account.wallet.address, 0n);
  const minimumGasRpc = provider();
  try { await minimumGasRpc.send('hardhat_setBalance', [account.wallet.address, toBeHex(parseEther('0.003'))]); }
  finally { minimumGasRpc.destroy(); }
  await page.getByRole('button', { name: 'Refresh blockchain status', exact: true }).click();
  await expect(page.getByTestId('chain-gas-budget')).toHaveText('0.003 POL');
  await expect(purchaseButton).toBeEnabled();
  await expect(page.getByTestId('chain-insufficient-gas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Buy level 1 · 10.00 tUSDT', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Maximum gas budget');
  await page.getByLabel('Confirm with your password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Pay 10.00 tUSDT on-chain', exact: true }).click();
  await expect(page.getByTestId('referral-code')).toHaveText(/^LOOP-/, { timeout: 30000 });
  await expect(page.getByTestId('referral-level')).toHaveText('Level 1 / 15');
  await fund(account.wallet.address, 0n);
  await page.getByRole('button', { name: 'Refresh blockchain status', exact: true }).click();
  await page.getByRole('button', { name: 'Buy level 2 · 20.00 tUSDT', exact: true }).click();
  await page.getByLabel('Confirm with your password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Pay 20.00 tUSDT on-chain', exact: true }).click();
  await expect(page.getByTestId('referral-level')).toHaveText('Level 2 / 15', { timeout: 30000 });
  await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).click();
  await page.getByRole('listbox').locator('[data-value="th"]').click();
  await expect(page.getByText(thai.onchain.networkHint, { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/onchain-referral-${info.project.name}.png`, fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('contract owner updates the fee address from admin and new purchases transfer to that address', async ({ page, playwright }, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(90000);
  const owner = await seedOwner(), recipient = Wallet.createRandom().address;
  await post(page.request, '/api/admin/login', { username: owner, password });
  await page.goto('/admin/settings');
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: unknown })?.__vue_app__));
  await expect(page.getByTestId('chain-fee-address')).toHaveText(process.env.REFERRAL_TEST_ORIGINAL_FEE!);
  await page.getByLabel('New on-chain fee address', { exact: true }).fill(recipient);
  await page.getByLabel('Confirm with your password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Update fee address on-chain', exact: true }).click();
  await expect(page.getByTestId('chain-fee-address')).toHaveText(recipient, { timeout: 30000 });
  const buyer = await playwright.request.newContext({ baseURL: origin }), rpc = provider();
  try {
    const account = await register(buyer); await fund(account.wallet.address);
    const purchase = await buy(buyer); await confirmed(buyer, purchase.id);
    const token = new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!, tokenAbi, rpc);
    expect(await token.getFunction('balanceOf')(recipient)).toBe(10_000_000n);
    const state = await (await page.request.get('/api/admin/referrals/status')).json();
    expect(state.chain.feeRecipient).toBe(recipient);
    expect(state.totals.platform).toBeGreaterThan(10);
    expect(state.feeUpdate.status).toBe('confirmed');
  } finally { await buyer.dispose(); rpc.destroy(); }
});
