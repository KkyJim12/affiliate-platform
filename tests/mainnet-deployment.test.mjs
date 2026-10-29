import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { network } from 'hardhat';
import { Contract, ContractFactory, JsonRpcProvider, Wallet, parseEther, toBeHex } from 'ethers';
import { compileContracts } from '../scripts/lib/compile-contracts.mjs';
import { POLYGON_USDT } from '../scripts/lib/mainnet-deployment.mjs';

test('mainnet deployment reuses canonical USDT, persists one signed deployment and resumes without another transaction',{timeout:180000},async()=>{
  const root=process.cwd(),directory=await fs.mkdtemp(path.join(root,'.data/mainnet-deployment-test-'));
  const server=await network.createServer('polygon','127.0.0.1',0);
  let provider;
  try {
    const {port}=await server.listen(),url=`http://127.0.0.1:${port}`;
    provider=new JsonRpcProvider(url,undefined,{cacheTimeout:-1});
    await provider.send('evm_setIntervalMining',[100]);
    const fixtures=compileContracts({includeTests:true});
    const fixture=await new ContractFactory(fixtures.PolygonUsdtFixture.abi,fixtures.PolygonUsdtFixture.bytecode,await provider.getSigner(0)).deploy();
    await fixture.waitForDeployment();
    await provider.send('hardhat_setCode',[POLYGON_USDT,await provider.getCode(await fixture.getAddress())]);
    const owner=Wallet.createRandom(),fee=Wallet.createRandom(),authority=Wallet.createRandom(),deployer=Wallet.createRandom();
    await provider.send('hardhat_setBalance',[deployer.address,toBeHex(parseEther('10'))]);
    await fs.cp(path.join(root,'contracts'),path.join(directory,'contracts'),{recursive:true});
    await fs.mkdir(path.join(directory,'node_modules/@openzeppelin'),{recursive:true});
    await fs.cp(path.join(root,'node_modules/@openzeppelin/contracts'),path.join(directory,'node_modules/@openzeppelin/contracts'),{recursive:true});
    await fs.mkdir(path.join(directory,'.data/contracts'),{recursive:true});
    await fs.writeFile(path.join(directory,'.data/contracts/AmoyTestUSDT.json'),'Amoy record remains intact');
    await fs.writeFile(path.join(directory,'.env'),'AMOY_ENV=untouched\n');
    const env={NUXT_EVM_CHAIN_ID:'137',NUXT_PUBLIC_CHAIN_ID:'137',NUXT_EVM_RPC_URL:url,NUXT_EVM_TOKEN_ADDRESS:POLYGON_USDT,NUXT_REFERRAL_CONTRACT_ADDRESS:'',NUXT_REFERRAL_MIN_CONFIRMATIONS:'2',REFERRAL_OWNER_ADDRESS:owner.address,REFERRAL_FEE_RECIPIENT_ADDRESS:fee.address,REFERRAL_DEPLOYER_PRIVATE_KEY:deployer.privateKey,NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY:authority.privateKey,MAINNET_MAX_DEPLOYMENT_COST_POL:'2'};
    const save=()=>fs.writeFile(path.join(directory,'.env.mainnet'),Object.entries(env).map(([key,value])=>`${key}=${value}`).join('\n')+'\n');
    await save();
    const inherited={...process.env};for(const key of Object.keys(env))delete inherited[key];
    const run=(script,flags=[])=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--env-file=.env.mainnet',path.join(root,script),...flags],{cwd:directory,env:inherited});
      let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
      child.once('error',reject);child.once('exit',code=>resolve({code,output}));
    });
    const preview=await run('scripts/deploy-mainnet.mjs');
    assert.equal(preview.code,0,preview.output);assert.equal(await provider.getTransactionCount(deployer.address),0);
    assert.match(preview.output,/'?mockToken"?: false/);
    const lock=path.join(directory,'.data/contracts/polygon-mainnet/deployment.lock');
    await fs.writeFile(lock,JSON.stringify({pid:process.pid}));
    const locked=await run('scripts/deploy-mainnet.mjs',['--broadcast']);
    assert.equal(locked.code,1);assert.match(locked.output,/Another mainnet deployment/);
    assert.equal(await provider.getTransactionCount(deployer.address),0);
    await fs.unlink(lock);
    const result=await run('scripts/deploy-mainnet.mjs',['--broadcast']);
    assert.equal(result.code,0,result.output);
    assert.equal(await provider.getTransactionCount(deployer.address),1);
    for(const secret of [deployer.privateKey,authority.privateKey])assert.ok(!result.output.includes(secret));
    const record=JSON.parse(await fs.readFile(path.join(directory,'.data/contracts/polygon-mainnet/deployment-result.json'),'utf8'));
    const main=new Contract(record.contractAddress,fixtures.ReferralDistributor.abi,provider);
    assert.equal(await main.paymentToken(),POLYGON_USDT);assert.equal(await main.distributionVersion(),3n);
    assert.equal(await main.owner(),owner.address);assert.equal(await main.feeRecipient(),fee.address);assert.equal(await main.quoteSigner(),authority.address);
    assert.equal(await fs.readFile(path.join(directory,'.env'),'utf8'),'AMOY_ENV=untouched\n');
    assert.equal(await fs.readFile(path.join(directory,'.data/contracts/AmoyTestUSDT.json'),'utf8'),'Amoy record remains intact');
    const names=await fs.readdir(path.join(directory,'.data/contracts/polygon-mainnet'));
    assert.ok(!names.includes('AmoyTestUSDT.json'));
    assert.equal((await run('scripts/verify-mainnet.mjs',['--dry-run'])).code,0);
    assert.equal((await run('scripts/deploy-mainnet.mjs',['--broadcast'])).code,0);
    assert.equal(await provider.getTransactionCount(deployer.address),1);
    const current=await fs.readFile(path.join(directory,'.env.mainnet'),'utf8');
    assert.ok(current.includes(`NUXT_REFERRAL_CONTRACT_ADDRESS=${record.contractAddress}`));
    // Tampered token, mismatched chain and changed constructors cannot broadcast.
    env.NUXT_EVM_TOKEN_ADDRESS=Wallet.createRandom().address;await save();assert.equal((await run('scripts/deploy-mainnet.mjs',['--broadcast'])).code,1);
    env.NUXT_EVM_TOKEN_ADDRESS=POLYGON_USDT;env.NUXT_EVM_CHAIN_ID='80002';await save();assert.equal((await run('scripts/deploy-mainnet.mjs',['--broadcast'])).code,1);
    assert.equal(await provider.getTransactionCount(deployer.address),1);
  }finally{
    provider?.destroy();await server.close();
    if(path.dirname(directory)!==path.join(root,'.data')||!path.basename(directory).startsWith('mainnet-deployment-test-'))throw new Error('Unexpected test directory.');
    await fs.rm(directory,{recursive:true,force:true});
  }
});
