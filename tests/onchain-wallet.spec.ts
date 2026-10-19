import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Contract, JsonRpcProvider, Transaction, Wallet, parseEther, toBeHex } from 'ethers';
import { openTestDatabase } from './database';
import thai from '../i18n/locales/th.json' with { type: 'json' };

const origin = 'http://127.0.0.1:3100', password = 'Onchain sending test password 42!';
const rpc = () => new JsonRpcProvider(process.env.NUXT_EVM_RPC_URL, undefined, { cacheTimeout: -1 });
const post = (api: APIRequestContext, path: string, body: object) => api.post(path, { headers: { Origin: origin }, data: body });
const tokenAbi = ['function mint(address,uint256)', 'function balanceOf(address) view returns (uint256)'];
test.skip(!process.env.REFERRAL_TEST_OWNER_KEY, 'Use npm run test:onchain with a disposable local EVM.');
test.beforeEach(async () => {
  const db = openTestDatabase(); try { await db.execute('DELETE FROM rate_limits'); } finally { await db.close(); }
});
async function account(api: APIRequestContext) {
  const username = `send_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const response = await post(api, '/api/auth/register', { username, password }); expect(response.status()).toBe(201);
  const { user } = await response.json(), { wallet } = await (await api.get('/api/wallet/evm')).json(), provider = rpc();
  try {
    await provider.send('hardhat_setBalance', [wallet.address, toBeHex(parseEther('1'))]);
    const token = new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!, tokenAbi, await provider.getSigner(0));
    await (await token.getFunction('mint')(wallet.address, 100_000_000n)).wait();
  } finally { provider.destroy(); }
  return { user, wallet, username };
}
async function quote(api: APIRequestContext, recipient: string, asset = 'native', amount = '0.01') {
  const response = await post(api, '/api/wallet/evm/send/quote', { recipient, asset, amount });
  expect(response.status(), await response.text()).toBe(200); return (await response.json()).quote;
}
const submit = (api: APIRequestContext, q: { id: string; quoteHash: string }, key = randomUUID(), secret = password) =>
  post(api, '/api/wallet/evm/send', { id: q.id, quoteHash: q.quoteHash, requestKey: key, password: secret });

test('authenticated wallet sends move exact POL and tokens once and never change the internal ledger', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'desktop'); test.setTimeout(120000);
  const owner = await playwright.request.newContext({ baseURL: origin }), other = await playwright.request.newContext({ baseURL: origin });
  const guest = await playwright.request.newContext({ baseURL: origin }), provider = rpc(), db = openTestDatabase();
  try {
    const first = await account(owner); await account(other);
    const recipient = Wallet.createRandom().address;
    const native = await quote(owner, recipient), key = randomUUID();
    expect(native).toMatchObject({ sender: first.wallet.address, recipient, asset: 'native', chainId: 80002, amount: '0.01' });
    expect(await provider.getTransactionCount(first.wallet.address)).toBe(0);
    expect((await guest.get('/api/wallet/evm/sends')).status()).toBe(401);
    expect((await submit(guest, native)).status()).toBe(401);
    expect((await submit(other, native)).status()).toBe(404);
    expect((await submit(owner, native, randomUUID(), 'incorrect')).status()).toBe(401);
    expect((await owner.post('/api/wallet/evm/send', { headers: { Origin: 'https://unrelated.example' }, data: { ...native, requestKey: key, password } })).status()).toBe(403);
    expect((await owner.post('/api/wallet/evm/send/quote', { data: { recipient, asset: 'native', amount: '0.01' } })).status()).toBe(403);
    expect((await submit(owner, { ...native, quoteHash: `0x${'00'.repeat(32)}` })).status()).toBe(409);
    expect((await db.one('SELECT raw_transaction FROM evm_sends WHERE id = $1', native.id))!.raw_transaction).toBeNull();
    const response = await submit(owner, native, key); expect([200, 202]).toContain(response.status());
    expect(response.headers()['cache-control']).toBe('no-store');
    const sent = (await response.json()).send;
    expect(JSON.stringify(sent)).not.toMatch(/raw_transaction|privateKey|encrypted_keystore/);
    await expect.poll(async () => (await (await owner.get('/api/wallet/evm/sends')).json()).sends.find((item: { id: string }) => item.id === sent.id)?.status).toBe('confirmed');
    expect(await provider.getBalance(recipient)).toBe(parseEther('0.01'));
    const stored = await db.one('SELECT * FROM evm_sends WHERE id = $1', native.id), signed = Transaction.from(stored!.raw_transaction);
    expect(signed.hash).toBe(sent.transactionHash); expect(signed.from).toBe(first.wallet.address); expect(signed.to).toBe(recipient);
    const receipt = await provider.getTransactionReceipt(sent.transactionHash);
    expect(await provider.getBalance(first.wallet.address)).toBe(parseEther('0.99') - receipt!.fee);
    for (const retryKey of [key, randomUUID()]) expect((await (await submit(owner, native, retryKey)).json()).send.transactionHash).toBe(sent.transactionHash);
    const tokenQuote = await quote(owner, recipient, 'token', '12.345678');
    expect((await submit(owner, tokenQuote, key)).status()).toBe(409);
    const tokenResponse = await submit(owner, tokenQuote); expect([200, 202]).toContain(tokenResponse.status());
    const token = new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!, tokenAbi, provider);
    expect(await token.getFunction('balanceOf')(recipient)).toBe(12_345_678n);
    expect(await token.getFunction('balanceOf')(first.wallet.address)).toBe(87_654_322n);
    expect(await provider.getTransactionCount(first.wallet.address)).toBe(2);
    expect((await (await other.get('/api/wallet/evm/sends')).json()).sends).toEqual([]);
    const ledger = await (await owner.get('/api/wallet')).json(); expect(ledger.available).toBe(0); expect(ledger.transactions).toEqual([]);
  } finally { await Promise.all([owner.dispose(), other.dispose(), guest.dispose(), db.close()]); provider.destroy(); }
});

test('pending sends persist before broadcast, block conflicting purchases and recover after the browser closes', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'desktop'); test.setTimeout(120000);
  const api = await playwright.request.newContext({ baseURL: origin }), provider = rpc(), db = openTestDatabase();
  try {
    const first = await account(api), recipient = Wallet.createRandom().address;
    const q = await quote(api, recipient), unused = await quote(api, recipient, 'token', '1');
    await provider.send('evm_setAutomine', [false]);
    const response = await submit(api, q); expect(response.status()).toBe(202);
    const sent = (await response.json()).send; expect(sent.status).toBe('pending');
    const row = await db.one('SELECT * FROM evm_sends WHERE id = $1', q.id);
    expect(Transaction.from(row!.raw_transaction).hash).toBe(sent.transactionHash);
    expect((await submit(api, unused)).status()).toBe(409);
    expect((await post(api, '/api/wallet/evm/send/quote', { recipient, asset: 'native', amount: '0.01' })).status()).toBe(409);
    const purchase = await post(api, '/api/referrals/chain/purchase', { password, level: 1, requestKey: randomUUID() });
    expect(purchase.status()).toBe(409);
    expect((await db.one('SELECT COUNT(*) AS count FROM referral_chain_purchases WHERE user_id = $1', first.user.id))!.count).toBe(0);
    await api.dispose(); await provider.send('evm_mine', []);
    await expect.poll(async () => (await db.one('SELECT status FROM evm_sends WHERE id = $1', q.id))?.status,
      { timeout: 45000, intervals: [1000, 3000, 5000] }).toBe('confirmed');
    expect(await provider.getBalance(recipient)).toBe(parseEther('0.01'));
  } finally { await provider.send('evm_setAutomine', [true]); await api.dispose(); provider.destroy(); await db.close(); }
});

test('pending referral purchases block both quoting and signing new sends', async ({ playwright }, info) => {
  test.skip(info.project.name !== 'desktop'); test.setTimeout(90000);
  const api = await playwright.request.newContext({ baseURL: origin }), provider = rpc();
  try {
    await account(api); const recipient = Wallet.createRandom().address, q = await quote(api, recipient);
    await provider.send('evm_setAutomine', [false]);
    expect((await post(api, '/api/referrals/chain/purchase', { password, level: 1, requestKey: randomUUID() })).status()).toBe(202);
    expect((await submit(api, q)).status()).toBe(409);
    expect((await post(api, '/api/wallet/evm/send/quote', { recipient, asset: 'native', amount: '0.01' })).status()).toBe(409);
    await provider.send('evm_mine', []);
  } finally { await provider.send('evm_setAutomine', [true]); await api.dispose(); provider.destroy(); }
});

test('members review and send POL and tokens with English/Thai on desktop and mobile', async ({ page }, info) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await account(page.request); const recipient = Wallet.createRandom().address;
  await page.goto('/dashboard?view=wallet');
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as HTMLElement & { __vue_app__?: unknown })?.__vue_app__));
  await expect(page.getByTestId('wallet-balance')).toContainText('100.00');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Recipient address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount', { exact: true }).fill('0.01');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await expect(page.getByTestId('evm-send-review')).toContainText(recipient);
  await expect(page.getByTestId('evm-send-review')).toContainText('Maximum gas fee');
  await page.getByLabel('Confirm with your password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('#send-password')).toHaveCount(0);
  await page.getByLabel('Recipient address', { exact: true }).fill(recipient);
  await page.getByLabel('Amount', { exact: true }).fill('0.01');
  await page.getByRole('button', { name: 'Review transfer', exact: true }).click();
  await page.getByLabel('Confirm with your password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Confirm and send', exact: true }).click();
  await expect(page.getByTestId('evm-send-history')).toContainText('0.01 POL');
  await expect(page.getByTestId('evm-send-history')).toContainText('Confirmed');
  await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).click();
  await page.getByRole('listbox').locator('[data-value="th"]').click();
  await page.getByRole('button', { name: thai.evmSend.title, exact: true }).click();
  await page.getByRole('combobox', { name: thai.evmSend.asset, exact: true }).click();
  await page.getByRole('listbox').locator('[data-value="token"]').click();
  await page.getByLabel(thai.evmSend.recipient, { exact: true }).fill(recipient);
  await page.getByLabel(thai.evmSend.amount, { exact: true }).fill('1.000001');
  await page.getByRole('button', { name: thai.evmSend.review, exact: true }).click();
  await expect(page.getByTestId('evm-send-review')).toContainText('1.000001 tUSDT');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/send-review-${info.project.name}.png`, fullPage: true, animations: 'disabled' });
  await page.locator('#send-password').fill(password);
  await page.getByRole('button', { name: thai.evmSend.confirm, exact: true }).click();
  await expect(page.getByTestId('evm-send-history')).toContainText('1.000001 tUSDT');
  await expect(page.getByTestId('evm-send-history').locator('[data-status="confirmed"]')).toHaveCount(2);
  const provider = rpc();
  try {
    expect(await provider.getBalance(recipient)).toBe(parseEther('0.01'));
    expect(await new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!, tokenAbi, provider).getFunction('balanceOf')(recipient)).toBe(1_000_001n);
  } finally { provider.destroy(); }
  expect(errors).toEqual([]);
});
