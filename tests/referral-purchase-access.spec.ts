import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Contract, JsonRpcProvider, parseEther, toBeHex } from 'ethers';
import { openTestDatabase } from './database';

const origin='http://127.0.0.1:3100',password='Required referral integration password 42!';
const contractMode=process.env.NUXT_REFERRAL_PAYMENT_MODE==='contract';
const post=(api:APIRequestContext,path:string,data:object)=>api.post(path,{headers:{Origin:origin},data});
async function register(api:APIRequestContext) {
  const response=await post(api,'/api/auth/register',{password});
  expect(response.status(),await response.text()).toBe(201);
  return (await response.json()).user as {id:string;memberId:string};
}
async function fund(api:APIRequestContext,member:{id:string}) {
  const db=openTestDatabase();
  try {await db.execute('UPDATE wallets SET available=100000000 WHERE user_id=$1',member.id);}
  finally {await db.close();}
  if(contractMode) {
    const wallet=(await (await api.get('/api/wallet/evm')).json()).wallet;
    const rpc=new JsonRpcProvider(process.env.NUXT_EVM_RPC_URL,undefined,{cacheTimeout:-1});
    try {
      const token=new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!,['function mint(address,uint256)'],await rpc.getSigner(0));
      await (await token.mint(wallet.address,100_000_000n)).wait();
      await rpc.send('hardhat_setBalance',[wallet.address,toBeHex(parseEther('1'))]);
    } finally {rpc.destroy();}
  }
}
async function buy(api:APIRequestContext) {
  const response=await post(api,contractMode?'/api/referrals/chain/purchase':'/api/referrals/activate',{password,level:1,requestKey:randomUUID()});
  expect([200,202],await response.text()).toContain(response.status());
  await expect.poll(async()=>{
    if(contractMode) await api.get('/api/referrals/chain/status');
    return (await (await api.get('/api/referrals/program')).json()).currentLevel;
  },{timeout:30000}).toBe(1);
}

test('ref ID validation blocks forged requests and enables purchases after a valid ID is connected',async({page,playwright},info)=>{
  test.skip(info.project.name!=='desktop');
  test.skip(process.env.NUXT_PUBLIC_WALLET_MODE==='external');
  test.setTimeout(90000);
  const sponsorApi=await playwright.request.newContext({baseURL:origin}),db=openTestDatabase();
  try {
    const sponsor=await register(sponsorApi);await fund(sponsorApi,sponsor);
    if(sponsor.memberId==='1') {
      expect((await (await sponsorApi.get('/api/referrals/program')).json()).purchaseAccess).toEqual({allowed:true,exempt:true,requiresSponsor:false});
      await buy(sponsorApi);
    } else {
      // A historical paid sponsor fixture; it remains subject to the new rule
      // for future purchases, while its invitation code is already active.
      const transaction=randomUUID();
      await db.execute("INSERT INTO wallet_transactions VALUES($1,(SELECT id FROM wallets WHERE user_id=$2),'referral_purchase',10000000,'completed','Historic test activation',$1,$3)",transaction,sponsor.id,new Date().toISOString());
      await db.execute('INSERT INTO referral_activations(user_id,transaction_id,created_at) VALUES($1,$2,$3)',sponsor.id,transaction,new Date().toISOString());
    }
    sponsor.memberId=(await (await sponsorApi.get('/api/auth/session')).json()).user.memberId;
    const member=await register(page.request);await fund(page.request,member);
    const program=await (await page.request.get('/api/referrals/program')).json();
    expect(program.purchaseAccess).toEqual({allowed:false,exempt:false,requiresSponsor:true});
    for(const [path,level] of [[contractMode?'/api/referrals/chain/purchase':'/api/referrals/activate',1],['/api/referrals/chain/prepare',1],...(contractMode?[]:[['/api/referrals/upgrade',2]])] as const) {
      const blocked=await post(page.request,path,{password,level,requestKey:randomUUID(),sponsorExempt:true,sponsorCode:sponsor.memberId,memberId:'1',userId:sponsor.id});
      expect(blocked.status(),await blocked.text()).toBe(409);
      expect((await blocked.json()).statusMessage).toBe('Add a valid ref ID before purchasing a level.');
    }
    expect((await db.one('SELECT available FROM wallets WHERE user_id=$1',member.id))!.available).toBe(100000000);
    expect((await db.one('SELECT COUNT(*) AS count FROM referral_chain_purchases WHERE user_id=$1',member.id))!.count).toBe(0);
    expect((await db.one('SELECT COUNT(*) AS count FROM referral_purchases WHERE user_id=$1',member.id))!.count).toBe(0);
    for(const code of ['0',member.memberId,'9007199254740991']) {
      expect((await post(page.request,'/api/referrals/sponsor',{code})).status()).toBe(400);
    }
    await page.goto('/referrals');
    await expect(page.getByTestId('referral-required')).toBeVisible();
    const button=page.locator('.referral-unlock-button');
    await expect(button).toBeDisabled();
    await page.locator('#referral-sponsor-code').fill('0');
    await page.locator('.referral-sponsor-form button[type="submit"]').click();
    await expect(page.locator('.referral-sponsor-form [role="alert"]')).toBeVisible();
    await expect(button).toBeDisabled();
    await page.locator('#referral-sponsor-code').fill(sponsor.memberId);
    // Typing a valid ID alone must not unlock payment before the link is saved.
    await expect(button).toBeDisabled();
    await page.locator('.referral-sponsor-form button[type="submit"]').click();
    await expect(page.getByTestId('referral-sponsor')).toHaveText(`ID ${sponsor.memberId}`);
    await expect(page.getByTestId('referral-required')).toHaveCount(0);
    await expect(button).toBeEnabled();
    expect((await (await page.request.get('/api/referrals/program')).json()).purchaseAccess).toEqual({allowed:true,exempt:false,requiresSponsor:false});
    await buy(page.request);
    if(contractMode) {
      const payload=(await db.one('SELECT payload FROM referral_chain_purchases WHERE user_id=$1',member.id))!.payload;
      expect(payload.quote.sponsorExempt).toBe(false);
      expect(payload.quote.sponsor).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(payload.quote.sponsor).not.toBe(`0x${'0'.repeat(40)}`);
    }
  } finally {await sponsorApi.dispose();await db.close();}
});
