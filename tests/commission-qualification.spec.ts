import { test,expect,type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../server/lib/password';
import { openTestDatabase } from './database';

const password='Commission qualification testing 42!',origin='http://127.0.0.1:3100';
test('commissions are held until two paid personal referrals, then released once without counting spillover or upgrades',async({page,playwright},info)=>{
  test.skip(info.project.name!=='desktop' || process.env.NUXT_REFERRAL_PAYMENT_MODE==='contract');
  test.setTimeout(90000);
  const db=openTestDatabase(),buyer=await playwright.request.newContext({baseURL:origin}),root=page.request,hash=await hashPassword(password);
  const create=async(sponsor:string|null)=>{
    const id=randomUUID(),row=await db.one("INSERT INTO users VALUES($1,$2,$3,$1,$4,$5) RETURNING referral_code",id,`qual_${id.slice(0,8)}`,hash,sponsor,new Date().toISOString());
    await db.execute("INSERT INTO wallets(id,user_id,available) VALUES($1,$2,100000000)",`w-${id}`,id);
    return {id,code:row!.referral_code};
  };
  const post=(api:APIRequestContext,path:string,data:object)=>api.post(path,{headers:{Origin:origin},data});
  const activate=async(member:{code:unknown},api:APIRequestContext)=>{
    expect((await post(api,'/api/auth/login',{memberId:member.code,password})).status()).toBe(200);
    const response=await post(api,'/api/referrals/activate',{password,requestKey:randomUUID()});
    expect(response.status(),await response.text()).toBe(200);
  };
  try {
    await db.execute('DELETE FROM rate_limits');
    const owner=await create(null);await activate(owner,root);
    const first=await create(owner.id);await activate(first,buyer);
    const upgrade=await post(buyer,'/api/referrals/upgrade',{level:2,password,requestKey:randomUUID()});expect(upgrade.status(),await upgrade.text()).toBe(200);
    const spillover=await create(first.id);await activate(spillover,buyer);
    const second=await create(owner.id);
    const before=await (await root.get('/api/referrals/program')).json();
    expect(before.commissionQualification).toEqual({paidReferrals:1,required:2,qualified:false,heldBalance:3.2});
    expect((await (await root.get('/api/wallet')).json()).available).toBe(90);
    expect((await (await root.get('/api/dashboard')).json()).commissions).toBe(0);
    await page.goto('/referrals');
    await expect(page.getByTestId('commission-qualification')).toContainText('1/2');
    await expect(page.getByTestId('commission-qualification')).toContainText('3.20 USDT');
    await activate(second,buyer);
    const after=await (await root.get('/api/referrals/program')).json();
    expect(after.commissionQualification).toEqual({paidReferrals:2,required:2,qualified:true,heldBalance:0});
    expect((await (await root.get('/api/wallet')).json()).available).toBe(94.3);
    expect((await (await root.get('/api/dashboard')).json()).commissions).toBe(4.3);
    await expect(page.getByTestId('commission-qualification')).toContainText('2/2',{timeout:25000});
    const released=await db.one("SELECT COUNT(*) AS count FROM wallet_transactions WHERE wallet_id=$1 AND request_key LIKE 'referral-release:%'",`w-${owner.id}`);
    expect(released!.count).toBe(4);
    expect((await post(buyer,'/api/referrals/activate',{password,requestKey:randomUUID()})).status()).toBe(200);
    expect((await (await root.get('/api/wallet')).json()).available).toBe(94.3);
    expect((await db.one("SELECT COUNT(*) AS count FROM referral_allocations WHERE recipient_user_id=$1 AND status='held'",owner.id))!.count).toBe(0);
  } finally {await buyer.dispose();await db.close();}
});
