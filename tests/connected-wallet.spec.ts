import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Contract, JsonRpcProvider, Wallet, getBytes, parseEther, toBeHex, type BaseWallet } from 'ethers';
import { openTestDatabase } from './database';
import { hashPassword } from '../server/lib/password';
import type { ExternalPurchase, WalletCall } from '../shared/connected-wallet';
import { passwordLoginEnabled } from '../shared/auth-mode';
import thai from '../i18n/locales/th.json' with { type: 'json' };

test.skip(process.env.NUXT_PUBLIC_WALLET_MODE !== 'external' || !process.env.REFERRAL_TEST_OWNER_KEY, 'Run npm run test:connected against disposable local databases.');
const origin = 'http://127.0.0.1:3100';
const passwordLogin = passwordLoginEnabled(process.env.NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED);
const rpc = () => new JsonRpcProvider(process.env.NUXT_EVM_RPC_URL,undefined,{ cacheTimeout: -1 });
const post = (api: APIRequestContext,path: string,data: object) => api.post(path,{ headers: { Origin: origin },data });
async function login(api: APIRequestContext,wallet: BaseWallet,sponsorCode = '') {
  const challenge = await (await post(api,'/api/auth/wallet/challenge',{ address: wallet.address,sponsorCode })).json();
  const response = await post(api,'/api/auth/wallet/verify',{ id: challenge.id,signature: await wallet.signMessage(challenge.message) });
  expect(response.status(),await response.text()).toBe(200); return (await response.json()).user;
}
async function fund(wallet: BaseWallet,provider: JsonRpcProvider) {
  await provider.send('hardhat_setBalance',[wallet.address,toBeHex(parseEther('100'))]);
  const token = new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!,['function mint(address,uint256)'],await provider.getSigner(0));
  await (await token.getFunction('mint')(wallet.address,100_000_000n)).wait();
}
async function signCall(wallet: BaseWallet,call: WalletCall) {
  return wallet.sendTransaction({ to: call.to,data: call.data,value: BigInt(call.value),chainId: call.chainId,
    ...(call.gasLimit ? { gasLimit: BigInt(call.gasLimit) } : {}),...(call.nonce !== undefined ? { nonce: call.nonce } : {}) });
}
async function buy(api: APIRequestContext,wallet: BaseWallet,level = 1,attach = true) {
  const response = await post(api,'/api/referrals/chain/prepare',{ level,requestKey: randomUUID() });
  expect(response.status(),await response.text()).toBe(200);
  const prepared = await response.json() as ExternalPurchase;
  for (const call of prepared.calls) {
    const tx = await signCall(wallet,call); await tx.wait();
    if (call.stage === 'purchase' && attach) expect((await post(api,'/api/referrals/chain/confirm',{ id: prepared.id,transactionHash: tx.hash })).status()).toBe(200);
  }
  await expect.poll(async () => { await api.get('/api/referrals/chain/status');
    return (await (await api.get('/api/referrals/chain/purchases')).json()).find((row: { id: string }) => row.id === prepared.id)?.status;
  }).toBe('confirmed');
  return prepared.id;
}
async function injectWallets(page: Page,wallet: BaseWallet,provider: JsonRpcProvider) {
  await page.exposeFunction('walletBridge',async (method: string,params: unknown[]) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet.address];
    if (method === 'personal_sign') return wallet.signMessage(getBytes(String(params[0])));
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
    if (method === 'eth_sendTransaction') {
      const tx = params[0] as Record<string,string>;
      const sent = await wallet.sendTransaction({ to: tx.to,data: tx.data,value: BigInt(tx.value || '0'),
        ...(tx.gas ? { gasLimit: BigInt(tx.gas) } : {}),...(tx.nonce ? { nonce: Number(tx.nonce) } : {}) });
      return sent.hash;
    }
    return provider.send(method,params);
  });
  await page.addInitScript(() => {
    const browser = window as any; browser.walletCalls = []; browser.rejectWallet = false;
    const events: Record<string,Function[]> = {};
    browser.walletEvents = events;
    const wallets = ['MetaMask','Rabby','Phantom'].map((name,index) => ({
      info: { uuid: `test-wallet-${index}`,name,rdns: ['io.metamask','io.rabby','app.phantom'][index],icon: '' },
      provider: { request: async ({ method,params = [] }: { method: string; params: unknown[] }) => {
        browser.walletCalls.push({ name,method,params });
        if (method === 'eth_accounts' && browser.readWalletAccount) return [browser.readWalletAccount];
        if (browser.rejectWallet && ['personal_sign','eth_sendTransaction'].includes(method)) throw Object.assign(new Error('User rejected request'),{ code: 4001 });
        return browser.walletBridge(method,params);
      },on: (event: string,listener: Function) => { (events[event] ||= []).push(listener); },removeListener: (event: string,listener: Function) => { events[event] = (events[event] || []).filter(item => item !== listener); } },
    }));
    window.addEventListener('eip6963:requestProvider',() => wallets.forEach(detail => window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{ detail }))));
  });
}

test('wallet authentication is nonce-bound, one-time, origin-bound and creates no server keystore',async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: origin }), database = openTestDatabase(), wallet = Wallet.createRandom();
  try {
    const challenge = await (await post(api,'/api/auth/wallet/challenge',{ address: wallet.address })).json();
    const wrong = await Wallet.createRandom().signMessage(challenge.message);
    expect((await post(api,'/api/auth/wallet/verify',{ id: challenge.id,signature: wrong })).status()).toBe(401);
    const signature = await wallet.signMessage(challenge.message);
    const response = await post(api,'/api/auth/wallet/verify',{ id: challenge.id,signature }); expect(response.status()).toBe(200);
    const user = (await response.json()).user;
    expect((await post(api,'/api/auth/wallet/verify',{ id: challenge.id,signature })).status()).toBe(401);
    expect((await api.get('/api/auth/session')).status()).toBe(200);
    expect(await database.one('SELECT user_id FROM evm_wallets WHERE user_id = $1',user.id)).toBeUndefined();
    expect((await (await api.get('/api/wallet/evm')).json()).wallet.address).toBe(wallet.address);
    for (const path of ['/api/auth/register','/api/wallet/evm','/api/wallet/evm/reveal','/api/referrals/chain/purchase','/api/wallet/evm/send','/api/wallet/transfer','/api/wallet/deposit']) {
      expect((await post(api,path,{ password: 'anything',requestKey: randomUUID() })).status(),path).toBe(403);
    }
    expect((await api.post('/api/auth/wallet/challenge',{ headers: { Origin: 'https://wrong.example' },data: { address: wallet.address } })).status()).toBe(403);
    expect((await api.post('/api/auth/wallet/challenge',{ headers: { Host: 'phishing.example',Origin: 'http://phishing.example' },data: { address: wallet.address } })).status()).toBe(403);
    const expired = await (await post(api,'/api/auth/wallet/challenge',{ address: wallet.address })).json();
    await database.execute('UPDATE wallet_challenges SET expires_at = 1 WHERE id = $1',expired.id);
    expect((await post(api,'/api/auth/wallet/verify',{ id: expired.id,signature: await wallet.signMessage(expired.message) })).status()).toBe(401);
  } finally { await api.dispose(); await database.close(); }
});

test('wallet-only mode rejects member credentials while retaining administrator password login',async ({ playwright }) => {
  test.skip(passwordLogin, 'Password migration must be explicitly disabled for this check.');
  const database = openTestDatabase(), password = 'Existing account password 42!';
  try {
    const passwordHash = await hashPassword(password);
    for (const role of ['member','admin']) {
      const api = await playwright.request.newContext({ baseURL: origin }), id = randomUUID(), username = `old_${id.slice(0,8)}`;
      try {
        await database.execute('INSERT INTO users VALUES ($1,$2,$3,$4,NULL,$5)',id,username,passwordHash,`UNASSIGNED-${id}`,new Date().toISOString());
        await database.execute('INSERT INTO wallets (id,user_id) VALUES ($1,$2)',`LW-${id}`,id);
        if (role === 'admin') await database.execute("INSERT INTO user_access (user_id,role) VALUES ($1,'admin')",id);
        const path = role === 'admin' ? '/api/admin/login' : '/api/auth/login';
        const response = await post(api,path,{ username,password });
        expect(response.status(),await response.text()).toBe(role === 'admin' ? 200 : 403);
        const session = (await (await api.get('/api/auth/session')).json()).user;
        if (role === 'admin') expect(session).toMatchObject({ id,role });
        else {
          expect(response.headers()['set-cookie'] || '').not.toContain('loop_session=');
          expect(session).toBeNull();
        }
        expect((await database.one('SELECT COUNT(*) AS count FROM sessions WHERE user_id = $1',id))!.count).toBe(role === 'admin' ? 1 : 0);
        expect(await database.one('SELECT user_id FROM evm_wallets WHERE user_id = $1',id)).toBeUndefined();
        expect(await database.one('SELECT user_id FROM connected_wallets WHERE user_id = $1',id)).toBeUndefined();
      } finally { await api.dispose(); }
    }
  } finally { await database.close(); }
});

for (const role of ['member','admin']) test(`existing accounts link once as ${role}, retain account history, and keep the appropriate sign-in method`,async ({ playwright }) => {
  test.skip(role === 'member' && !passwordLogin, 'Member credential migration must be explicitly enabled.');
  const api = await playwright.request.newContext({ baseURL: origin }), database = openTestDatabase(), wallet = Wallet.createRandom();
  const id = randomUUID(), username = `old_${id.slice(0,8)}`, password = 'Existing account password 42!';
  const path = role === 'admin' ? '/api/admin/login' : '/api/auth/login';
  try {
    await database.execute('INSERT INTO users VALUES ($1,$2,$3,$4,NULL,$5)',id,username,await hashPassword(password),`UNASSIGNED-${id}`,new Date().toISOString());
    await database.execute('INSERT INTO wallets (id,user_id,available) VALUES ($1,$2,123000000)',`LW-${id}`,id);
    if (role === 'admin') await database.execute("INSERT INTO user_access (user_id,role) VALUES ($1,'admin')",id);
    expect((await post(api,path,{ username,password })).status()).toBe(200);
    const challenge = await (await post(api,'/api/auth/wallet/challenge',{ address: wallet.address,purpose: 'link' })).json();
    expect((await post(api,'/api/auth/wallet/verify',{ id: challenge.id,signature: await wallet.signMessage(challenge.message) })).status()).toBe(200);
    expect((await database.one('SELECT available FROM wallets WHERE user_id = $1',id))!.available).toBe(123000000);
    expect((await post(api,path,{ username,password })).status()).toBe(role === 'admin' ? 200 : 403);
    if (role === 'member') expect(await login(api,wallet)).toMatchObject({ id,role });
    else {
      const loginChallenge = await (await post(api,'/api/auth/wallet/challenge',{ address: wallet.address })).json();
      expect((await post(api,'/api/auth/wallet/verify',{ id: loginChallenge.id,signature: await wallet.signMessage(loginChallenge.message) })).status()).toBe(403);
    }
    const other = Wallet.createRandom(), replace = await (await post(api,'/api/auth/wallet/challenge',{ address: other.address,purpose: 'link' })).json();
    expect((await post(api,'/api/auth/wallet/verify',{ id: replace.id,signature: await other.signMessage(replace.message) })).status()).toBe(409);
  } finally { await api.dispose(); await database.close(); }
});

test('wallet-signed purchases recover without hash attachment, top upline receives 15%, and server never signs a buyer transaction',async ({ playwright }) => {
  test.setTimeout(120000);
  const provider = rpc(), database = openTestDatabase(), root = await playwright.request.newContext({ baseURL: origin }), child = await playwright.request.newContext({ baseURL: origin });
  const rootWallet = Wallet.createRandom().connect(provider), childWallet = Wallet.createRandom().connect(provider);
  try {
    const parent = await login(root,rootWallet); await fund(rootWallet,provider);
    const preparedResponse = await post(root,'/api/referrals/chain/prepare',{ level: 1,requestKey: randomUUID() });
    const prepared = await preparedResponse.json() as ExternalPurchase;
    expect(prepared.status.status).toBe('awaiting_signature'); expect(prepared.calls.map(call => call.stage)).toEqual(['approval','purchase']);
    expect((await (await root.get('/api/referrals/program')).json()).code).toBeNull();
    expect((await database.one('SELECT COUNT(*) AS count FROM referral_chain_transactions WHERE user_id = $1',parent.id))!.count).toBe(0);
    const unrelated = await rootWallet.sendTransaction({ to: childWallet.address,value: 1n }); await unrelated.wait();
    expect((await post(root,'/api/referrals/chain/confirm',{ id: prepared.id,transactionHash: unrelated.hash })).status()).toBe(400);
    const rootPurchaseId = await buy(root,rootWallet,1,false);
    const program = await (await root.get('/api/referrals/program')).json();
    const member = await login(child,childWallet,program.code); await fund(childWallet,provider);
    expect((await post(child,'/api/referrals/chain/confirm',{ id: rootPurchaseId,transactionHash: `0x${'11'.repeat(32)}` })).status()).toBe(404);
    await buy(child,childWallet);
    const token = new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!,['function balanceOf(address) view returns(uint256)'],provider);
    expect(await token.getFunction('balanceOf')(rootWallet.address)).toBe(96_500_000n);
    expect((await (await root.get('/api/dashboard')).json()).commissions).toBe(6.5);
    const allocation = await database.one("SELECT COUNT(*) AS count,SUM(a.amount) AS amount FROM referral_chain_allocations a JOIN referral_chain_purchases p ON p.id = a.purchase_id WHERE p.user_id = $1 AND a.reason = 'highest_upline' AND a.recipient_user_id = $2",member.id,parent.id);
    expect(allocation).toMatchObject({ count: 14,amount: 1400000 });
    expect((await database.one('SELECT COUNT(*) AS count FROM referral_chain_transactions'))!.count).toBe(0);
    expect((await database.one('SELECT COUNT(*) AS count FROM evm_wallets WHERE user_id = ANY($1::TEXT[])',[parent.id,member.id]))!.count).toBe(0);
    const send = await (await post(child,'/api/wallet/connected/send',{ asset: 'token',recipient: rootWallet.address,amount: '2',requestKey: randomUUID() })).json();
    const tx = await signCall(childWallet,send.call); await tx.wait();
    const confirmed = await post(child,'/api/wallet/connected/confirm',{ id: send.id,transactionHash: tx.hash });
    expect((await confirmed.json()).status).toBe('confirmed'); expect(await token.getFunction('balanceOf')(rootWallet.address)).toBe(98_500_000n);
    const free = await playwright.request.newContext({ baseURL: origin }), freeWallet = Wallet.createRandom().connect(provider);
    try {
      await login(free,freeWallet); await fund(freeWallet,provider);
      const waiting = await post(free,'/api/referrals/chain/prepare',{ level: 1,requestKey: randomUUID() });
      expect(waiting.status()).toBe(200);
      const waitingId = (await waiting.json()).id;
      expect((await post(free,'/api/referrals/sponsor',{ code: program.code })).status()).toBe(409);
      const waitingRow = await database.one('SELECT payload FROM referral_chain_purchases WHERE id = $1',waitingId);
      await provider.send('evm_setNextBlockTimestamp',[waitingRow!.payload.quote.deadline + 1]); await provider.send('evm_mine',[]);
      await free.get('/api/referrals/chain/status');
      expect((await database.one('SELECT status FROM referral_chain_purchases WHERE id = $1',waitingId))!.status).toBe('failed');
      expect((await (await free.get('/api/referrals/program')).json()).code).toBeNull();
      const fresh = await post(free,'/api/referrals/chain/prepare',{ level: 1,requestKey: randomUUID() });
      expect(fresh.status()).toBe(200); expect((await fresh.json()).id).not.toBe(waitingId);
    } finally { await free.dispose(); }
  } finally { await root.dispose(); await child.dispose(); await database.close(); provider.destroy(); }
});

test('administrator fee changes must be sent by the connected contract owner',async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: origin }), provider = rpc(), database = openTestDatabase();
  const owner = new Wallet(process.env.REFERRAL_TEST_OWNER_KEY!,provider), next = Wallet.createRandom().address;
  try {
    const user = await login(api,owner);
    await database.execute("INSERT INTO user_access (user_id,role) VALUES ($1,'admin')",user.id);
    const result = await post(api,'/api/admin/referrals/prepare-fee',{ address: next,requestKey: randomUUID() });
    expect(result.status(),await result.text()).toBe(200);
    const prepared = await result.json();
    const contract = new Contract(process.env.NUXT_REFERRAL_CONTRACT_ADDRESS!,['function feeRecipient() view returns(address)'],provider);
    expect(await contract.getFunction('feeRecipient')()).not.toBe(next);
    const tx = await signCall(owner,prepared.call); await tx.wait();
    expect((await (await post(api,'/api/wallet/connected/confirm',{ id: prepared.id,transactionHash: tx.hash })).json()).status).toBe('confirmed');
    expect(await contract.getFunction('feeRecipient')()).toBe(next);
    expect((await database.one('SELECT fee_recipient_address FROM platform_settings WHERE id = 1'))!.fee_recipient_address).toBe(next);
  } finally { await api.dispose(); await database.close(); provider.destroy(); }
});

test('wallet-only members see wallet choices and administrators see credentials',async ({ page }) => {
  test.skip(passwordLogin, 'Password migration must be explicitly disabled for this check.');
  const provider = rpc(), wallet = Wallet.createRandom().connect(provider);
  try {
    await injectWallets(page,wallet,provider); await page.goto('/dashboard');
    await page.getByRole('button',{ name: /^Sign in$/ }).first().click();
    const member = page.getByRole('dialog');
    for (const name of ['MetaMask','Rabby','Phantom']) await expect(member.getByRole('button',{ name,exact: true })).toBeVisible();
    await expect(member.locator('input[autocomplete="username"], input[type="password"], input[autocomplete="current-password"]')).toHaveCount(0);
    await expect(member.getByRole('button',{ name: 'Already have a username account?',exact: true })).toHaveCount(0);
    await page.goto('/admin/login');
    for (const name of ['MetaMask','Rabby','Phantom']) await expect(page.getByRole('button',{ name,exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Username',{ exact: true })).toBeVisible();
    await expect(page.getByLabel('Password',{ exact: true })).toBeVisible();
    await expect(page.getByRole('button',{ name: 'Already have a username account?',exact: true })).toHaveCount(0);
  } finally { provider.destroy(); }
});

test('member migration is opt-in while administrators always have a password form',async ({ page }) => {
  test.skip(!passwordLogin, 'Enable NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED=true to test explicit credential migration.');
  const provider = rpc(), wallet = Wallet.createRandom().connect(provider);
  try {
    await injectWallets(page,wallet,provider); await page.goto('/dashboard');
    await page.getByRole('button',{ name: /^Sign in$/ }).first().click();
    const member = page.getByRole('dialog');
    await member.getByRole('button',{ name: 'Already have a username account?',exact: true }).click();
    await expect(member.getByLabel('Username',{ exact: true })).toBeVisible();
    await expect(member.getByLabel('Password',{ exact: true })).toBeVisible();
    await page.goto('/admin/login');
    await expect(page.getByLabel('Username',{ exact: true })).toBeVisible();
    await expect(page.getByLabel('Password',{ exact: true })).toBeVisible();
  } finally { provider.destroy(); }
});

test('administrator browser login uses credentials with a linked wallet',async ({ page,playwright }) => {
  const api = await playwright.request.newContext({ baseURL: origin }), database = openTestDatabase(), provider = rpc(), wallet = Wallet.createRandom().connect(provider);
  try {
    const user = await login(api,wallet);
    const password = 'Administrator credential password 42!';
    await database.execute('UPDATE users SET password_hash = $1 WHERE id = $2',await hashPassword(password),user.id);
    await database.execute("INSERT INTO user_access (user_id,role) VALUES ($1,'admin')",user.id);
    await injectWallets(page,wallet,provider); await page.goto('/admin/login');
    await page.getByLabel('Username',{ exact: true }).fill(user.username);
    await page.getByLabel('Password',{ exact: true }).fill(password);
    await page.getByRole('button',{ name: 'Sign in to admin',exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    expect((await (await page.request.get('/api/auth/session')).json()).user).toMatchObject({ id: user.id,role: 'admin' });
    const calls = await page.evaluate(() => (window as any).walletCalls);
    expect(calls.filter((call: any) => call.method === 'personal_sign')).toHaveLength(0);
    expect(calls.filter((call: any) => call.method === 'eth_sendTransaction')).toHaveLength(0);
  } finally { await api.dispose(); await database.close(); provider.destroy(); }
});

for (const name of ['MetaMask','Rabby','Phantom']) test(`${name} browser connection signs login; wallet details are a modal`,async ({ page }) => {
  const provider = rpc(), wallet = Wallet.createRandom().connect(provider);
  try {
    await injectWallets(page,wallet,provider); await page.goto('/dashboard');
    await page.getByRole('button',{ name: /^Sign in$/ }).first().click();
    await page.getByRole('button',{ name,exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('/dashboard?view=wallet');
    await expect(page.getByTestId('connected-wallet-panel')).toContainText(wallet.address);
    await page.getByRole('button',{ name: 'Wallet details',exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(wallet.address);
    await expect(page.getByRole('button',{ name: /Receive|Reveal private key|Create EVM wallet/ })).toHaveCount(0);
    const calls = await page.evaluate(() => (window as any).walletCalls);
    // Reload clears our test call log; login was recorded before navigation through server-side account state.
    expect((await page.request.get('/api/auth/session')).status()).toBe(200);
    await page.screenshot({ path: `.data/connected-${name.toLowerCase()}.png`,fullPage: true,animations: "disabled" });
  } finally { provider.destroy(); }
});

test('Thai wallet login and details fit a narrow mobile screen',async ({ page,context }) => {
  const provider = rpc(),wallet = Wallet.createRandom().connect(provider);
  try {
    await page.setViewportSize({ width: 390,height: 844 });
    await context.addCookies([{ name: 'loop_locale',value: 'th',url: origin }]);
    await injectWallets(page,wallet,provider); await page.goto('/dashboard');
    await page.getByRole('button',{ name: thai.ui.sign_in,exact: true }).first().click();
    await page.getByRole('button',{ name: 'Phantom',exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto('/dashboard?view=wallet');
    await page.getByRole('button',{ name: thai.evmWallet.details,exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText(wallet.address);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: '.data/connected-thai-mobile.png',fullPage: true,animations: "disabled" });
  } finally { provider.destroy(); }
});

test('browser purchase requests separate wallet approval and purchase signatures; rejection and account changes are handled',async ({ page }) => {
  test.setTimeout(120000);
  const provider = rpc(), wallet = Wallet.createRandom().connect(provider);
  try {
    await fund(wallet,provider); await injectWallets(page,wallet,provider); await page.goto('/dashboard');
    await page.getByRole('button',{ name: /^Sign in$/ }).first().click();
    await page.evaluate(() => { (window as any).rejectWallet = true; });
    await page.getByRole('button',{ name: 'MetaMask',exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('declined');
    await page.evaluate(() => { (window as any).rejectWallet = false; });
    await page.getByRole('button',{ name: 'MetaMask',exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('.sidebar-nav a[href="/referrals"]').click();
    await page.getByRole('button',{ name: /Buy level 1/ }).click();
    await page.getByRole('button',{ name: 'Sign purchase in wallet',exact: true }).click();
    await expect(page.getByTestId('referral-level')).toContainText('Level 1 / 15',{ timeout: 30000 });
    const calls = await page.evaluate(() => (window as any).walletCalls);
    expect(calls.filter((call: any) => call.method === 'personal_sign')).toHaveLength(2);
    expect(calls.filter((call: any) => call.method === 'eth_sendTransaction')).toHaveLength(2);
    expect(calls.filter((call: any) => call.method === 'eth_sendTransaction').every((call: any) => call.name === 'MetaMask')).toBe(true);
    await page.locator('.sidebar-nav a[href="/wallet"]').click();
    await page.evaluate(() => { const browser = window as any; browser.walletEvents.accountsChanged?.forEach((listener: Function) => listener(['0x1111111111111111111111111111111111111111'])); });
    await expect(page.getByRole('button',{ name: 'Send',exact: true })).toBeDisabled();
    await expect(page.getByTestId('connected-wallet-panel')).toContainText('Select the wallet linked');
  } finally { provider.destroy(); }
});

test('tUSDT balance and linked wallet agree across profile, referrals and wallet during navigation and after reload', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/hydration/i.test(message.text())) errors.push(message.text()); });
  const provider = rpc(), wallet = Wallet.createRandom().connect(provider);
  try {
    await fund(wallet, provider);
    await injectWallets(page, wallet, provider);
    await page.goto('/referrals');
    await page.locator('.sidebar-nav a[href="/wallet"]').click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
    await page.getByRole('button', { name: 'Rabby', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('profile-usdt-balance')).toHaveText('100.00 tUSDT');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/referrals', '/wallet']) {
        const approvals = await page.evaluate(() => (window as any).walletCalls.filter((call: { method: string }) =>
          ['eth_requestAccounts', 'personal_sign', 'eth_sendTransaction', 'wallet_switchEthereumChain'].includes(call.method)));
        const navigation = page.getByRole('button', { name: 'Open navigation', exact: true });
        if (await navigation.isVisible()) await navigation.click();
        await page.locator(`.sidebar-nav a[href="${path}"]`).click();
        await expect(page).toHaveURL(origin + path);
        await expect(page.locator('.profile-menu-trigger')).toBeVisible();
        await expect(page.locator('.dashboard-topbar .topbar-wallet')).toHaveCount(0);
        await expect(page.getByTestId('connected-wallet-address')).toHaveText(wallet.address);
        await expect(page.getByTestId('account-wallet-balance')).toHaveText('100.00 tUSDT');
        await expect(page.getByTestId('profile-usdt-balance')).toHaveText('100.00 tUSDT');
        const scope = path === '/wallet' ? page.getByTestId('connected-wallet-panel') : page.getByTestId('referral-wallet-summary');
        await expect(scope).toBeVisible();
        if (path === '/wallet') await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
        else await expect(page.getByRole('button', { name: /Buy level 1/ })).toBeEnabled();
        await page.locator('.profile-menu-trigger').click();
        await expect(page.getByTestId('profile-wallet-address')).toHaveText(wallet.address);
        await expect(page.getByRole('menu').getByTestId('account-wallet-balance')).toHaveText('100.00 tUSDT');
        await page.keyboard.press('Escape');
        const calls = await page.evaluate(() => (window as any).walletCalls as { name: string; method: string }[]);
        expect(calls.filter(call => ['eth_requestAccounts', 'personal_sign', 'eth_sendTransaction', 'wallet_switchEthereumChain'].includes(call.method))).toEqual(approvals);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.reload();
        await expect(page.getByTestId('connected-wallet-address')).toHaveText(wallet.address);
        await expect(page.getByTestId('profile-usdt-balance')).toHaveText('100.00 tUSDT');
        if (path === '/wallet') await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
        else await expect(page.getByRole('button', { name: /Buy level 1/ })).toBeEnabled();
        const restoredCalls = await page.evaluate(() => (window as any).walletCalls as { name: string; method: string }[]);
        expect(restoredCalls.filter(call => ['eth_requestAccounts', 'personal_sign', 'eth_sendTransaction', 'wallet_switchEthereumChain'].includes(call.method))).toEqual([]);
        expect(restoredCalls.some(call => call.name === 'Rabby' && call.method === 'eth_accounts')).toBe(true);
        await page.screenshot({ path: `.data/shared-wallet-${path.slice(1)}-${width}.png`, fullPage: true, animations: 'disabled' });
      }
    }
    await page.reload();
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    await page.evaluate(() => { (window as any).walletEvents.chainChanged?.forEach((listener: Function) => listener('0x89')); });
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await page.addInitScript(() => { (window as any).readWalletAccount = '0x1111111111111111111111111111111111111111'; });
    await page.reload();
    await expect(page.getByTestId('connected-wallet-address')).toHaveText(wallet.address);
    await expect(page.getByTestId('profile-usdt-balance')).toHaveText('100.00 tUSDT');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Rabby', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { provider.destroy(); }
});

test('an existing wallet session replaces a guest-rendered referral or wallet page without refreshing', async ({ page }) => {
  test.setTimeout(90_000);
  const provider = rpc(), wallet = Wallet.createRandom().connect(provider);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/hydration/i.test(message.text())) errors.push(message.text()); });
  try {
    const user = await login(page.request, wallet);
    await fund(wallet, provider);
    await injectWallets(page, wallet, provider);
    // Cross-site entries can omit a Strict cookie from the document request
    // while subsequent same-site API requests still have a valid session.
    await page.route(/\/(?:referrals|wallet)(?:\?.*)?$/, async route => {
      if (!route.request().isNavigationRequest()) return route.fallback();
      const headers = route.request().headers();
      headers.cookie = (headers.cookie || '').split(';').filter(cookie => !cookie.trim().startsWith('loop_session=')).join(';');
      const response = await route.fetch({ headers });
      expect(await response.text()).not.toContain(user.username);
      await route.fulfill({ response });
    });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/referrals', '/wallet']) {
        await page.goto(path);
        await expect(page.getByRole('button', { name: `Profile menu for ${user.username}`, exact: true })).toBeVisible();
        await expect(page.locator('.dashboard-topbar .topbar-wallet')).toHaveCount(0);
        await expect(page.getByTestId('connected-wallet-address')).toHaveText(wallet.address);
        await expect(page.getByTestId('account-wallet-balance')).toHaveText('100.00 tUSDT');
        const nextPath = path === '/referrals' ? '/wallet' : '/referrals';
        const navigation = page.getByRole('button', { name: 'Open navigation', exact: true });
        if (await navigation.isVisible()) await navigation.click();
        await page.locator(`.sidebar-nav a[href="${nextPath}"]`).click();
        await expect(page).toHaveURL(origin + nextPath);
        const scope = nextPath === '/wallet' ? page.getByTestId('connected-wallet-panel') : page.getByTestId('referral-wallet-summary');
        await expect(scope).toBeVisible();
        await expect(scope.getByTestId('connected-wallet-address')).toHaveText(wallet.address);
        const calls = await page.evaluate(() => (window as any).walletCalls as { method: string }[]);
        expect(calls.filter(call => ['eth_requestAccounts', 'personal_sign', 'eth_sendTransaction', 'wallet_switchEthereumChain'].includes(call.method))).toEqual([]);
      }
    }
    expect(errors).toEqual([]);
  } finally { provider.destroy(); }
});

test('a delayed guest session read does not replace a completed wallet sign-in', async ({ page }) => {
  test.setTimeout(90_000);
  const provider = rpc(), wallet = Wallet.createRandom().connect(provider);
  let releaseSession!: () => void, sessionRead!: () => void;
  const released = new Promise<void>(resolve => { releaseSession = resolve; });
  const started = new Promise<void>(resolve => { sessionRead = resolve; });
  try {
    await fund(wallet, provider);
    await injectWallets(page, wallet, provider);
    await page.route('**/api/auth/session', async route => {
      const response = await route.fetch();
      expect((await response.json()).user).toBeNull();
      sessionRead();
      await released;
      await route.fulfill({ response });
    }, { times: 1 });
    await page.goto('/dashboard');
    await started;
    await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
    await page.getByRole('button', { name: 'Rabby', exact: true }).click();
    await expect(page.getByTestId('profile-usdt-balance')).toHaveText('100.00 tUSDT');
    const finished = page.waitForEvent('requestfinished', request => request.url().endsWith('/api/auth/session'));
    releaseSession();
    await finished;
    await page.locator('.sidebar-nav a[href="/wallet"]').click();
    await expect(page.getByTestId('connected-wallet-panel').getByTestId('connected-wallet-address')).toHaveText(wallet.address);
    await expect(page.locator('.profile-menu-trigger')).toBeVisible();
    await expect(page.locator('.dashboard-topbar .topbar-wallet')).toHaveCount(0);
  } finally { releaseSession(); provider.destroy(); }
});
