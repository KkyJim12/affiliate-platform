import { test,expect,type APIRequestContext } from '@playwright/test';
import { Contract,JsonRpcProvider,Wallet,getBytes,parseEther,toBeHex } from 'ethers';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from './database';
import type { WalletCall } from '../shared/connected-wallet';

test.skip(process.env.NUXT_EVM_CHAIN_ID!=='137'||!process.env.REFERRAL_TEST_OWNER_KEY,'Use npm run test:mainnet:app with its isolated local chain.');
const origin='http://127.0.0.1:3100';
const post=(api:APIRequestContext,path:string,data:object)=>api.post(path,{headers:{Origin:origin},data});
const rpc=()=>new JsonRpcProvider(process.env.NUXT_EVM_RPC_URL,undefined,{cacheTimeout:-1});

async function funding(provider:JsonRpcProvider,wallet:{address:string}) {
  expect(new URL(process.env.NUXT_EVM_RPC_URL!).hostname).toBe('127.0.0.1');
  await provider.send('hardhat_setBalance',[wallet.address,toBeHex(parseEther('10'))]);
  const token=new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!,['function mint(address,uint256)'],await provider.getSigner(0));
  await(await token.getFunction('mint')(wallet.address,100000000n)).wait();
}

test('mainnet registration, purchase receipts, balances and token transfers use chain 137',async({request})=>{
  const provider=rpc(),wallet=Wallet.createRandom().connect(provider),database=openTestDatabase();
  try {
    await funding(provider,wallet);
    const challenge=await(await post(request,'/api/auth/wallet/challenge',{address:wallet.address})).json();
    expect(challenge.message).toContain('Chain ID: 137\n');
    const login=await post(request,'/api/auth/wallet/verify',{id:challenge.id,signature:await wallet.signMessage(challenge.message)});
    expect(login.status()).toBe(200);const user=(await login.json()).user;
    const metadata=await(await request.get('/api/wallet/evm')).json();
    expect(metadata.wallet).toMatchObject({chainId:137,network:'Polygon',testnet:false});
    const prepared=await(await post(request,'/api/referrals/chain/prepare',{level:1,requestKey:randomUUID()})).json();
    expect(prepared.calls.length).toBeGreaterThan(0);
    for(const call of prepared.calls as (WalletCall&{stage:string})[]) {
      expect(call.chainId).toBe(137);
      const tx=await wallet.sendTransaction({to:call.to,data:call.data,value:BigInt(call.value),gasLimit:BigInt(call.gasLimit!),chainId:137});await tx.wait();
      if(call.stage==='purchase')expect((await post(request,'/api/referrals/chain/confirm',{id:prepared.id,transactionHash:tx.hash})).status()).toBe(200);
    }
    await request.get('/api/referrals/chain/status');
    expect((await(await request.get('/api/referrals/program')).json()).currentLevel).toBe(1);
    expect((await database.one("SELECT chain_id FROM referral_chain_purchases WHERE user_id=$1 AND status='confirmed'",user.id))!.chain_id).toBe(137);
    expect((await database.one('SELECT chain_id FROM platform_network'))!.chain_id).toBe(137);
    const balances=await(await request.get('/api/wallet/evm/balance')).json();
    expect(balances.chainId).toBe(137);expect(balances.token.symbol).toBe('USDT0');expect(balances.token.balance).toBe('90');
    const recipient=Wallet.createRandom().address;
    const send=await(await post(request,'/api/wallet/connected/send',{asset:'token',recipient,amount:'1',requestKey:randomUUID()})).json();
    expect(send.call.chainId).toBe(137);
    const tx=await wallet.sendTransaction({to:send.call.to,data:send.call.data,value:BigInt(send.call.value),chainId:137});await tx.wait();
    const confirmed=await(await post(request,'/api/wallet/connected/confirm',{id:send.id,transactionHash:tx.hash})).json();
    expect(confirmed.status).toBe('confirmed');
    const token=new Contract(process.env.NUXT_EVM_TOKEN_ADDRESS!,['function balanceOf(address) view returns(uint256)'],provider);
    expect(await token.getFunction('balanceOf')(recipient)).toBe(1000000n);
  }finally{await database.close();provider.destroy();}
});

test('mainnet wallet UI switches to Polygon, shows USDT0, and uses mainnet explorer links',async({page},info)=>{
  const provider=rpc(),wallet=Wallet.createRandom().connect(provider);
  const failures:string[]=[];page.on('pageerror',error=>failures.push(error.message));
  try {
    await funding(provider,wallet);
    await page.exposeFunction('mainnetWalletBridge',async(method:string,params:unknown[])=>{
      if(['eth_accounts','eth_requestAccounts'].includes(method))return[wallet.address];
      if(method==='personal_sign')return wallet.signMessage(getBytes(String(params[0])));
      return provider.send(method,params);
    });
    await page.addInitScript(()=>{
      const browser=window as any;let chain='0x13882';browser.mainnetWalletCalls=[];
      const detail={info:{uuid:'mainnet-test-wallet',name:'MetaMask',rdns:'io.metamask',icon:''},provider:{
        request:async({method,params=[]}:{method:string;params:any[]})=>{
          browser.mainnetWalletCalls.push({method,params});
          if(method==='eth_chainId')return chain;
          if(method==='wallet_switchEthereumChain'){chain=params[0].chainId;return null;}
          return browser.mainnetWalletBridge(method,params);
        },on(){},removeListener(){},
      }};
      window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail})));
    });
    await page.goto('/wallet');
    await page.getByRole('button',{name:'Sign in',exact:true}).first().click();
    await page.getByRole('button',{name:'MetaMask',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('connected-wallet-address')).toHaveText(wallet.address);
    await expect(page.getByTestId('account-wallet-balance')).toHaveText('100.00 USDT0');
    const switches=await page.evaluate(()=>(window as any).mainnetWalletCalls.filter((call:any)=>call.method==='wallet_switchEthereumChain'));
    expect(switches[0].params[0].chainId).toBe('0x89');
    await expect(page.getByTestId('connected-wallet-panel')).toContainText('Polygon');
    await expect(page.getByTestId('connected-wallet-panel')).not.toContainText('Amoy');
    await page.getByRole('button',{name:'Wallet details',exact:true}).click();
    await expect(page.getByRole('link',{name:'View on explorer',exact:true}).first()).toHaveAttribute('href',`https://polygonscan.com/address/${wallet.address}`);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('polygon-mainnet-wallet.png'),fullPage:true});
    expect(failures).toEqual([]);
  }finally{provider.destroy();}
});
