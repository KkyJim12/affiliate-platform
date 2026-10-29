import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet, ZeroAddress, ZeroHash, verifyTypedData } from 'ethers';
import { polygonNetwork, polygonUsdtAddress } from '../shared/evm-wallet.ts';
import { walletChallengeMessage, verifyWalletChallenge } from '../server/lib/wallet-challenge.ts';
import { ReferralChainClient } from '../server/lib/referral-chain.ts';
import { purchaseTypes } from '../shared/referral-contract.ts';
import { mainnetConfig, POLYGON_USDT } from '../scripts/lib/mainnet-deployment.mjs';
import { compileContracts } from '../scripts/lib/compile-contracts.mjs';
import { EtherscanVerifier } from '../scripts/lib/referral-verification.mjs';

test('mainnet profile uses real Polygon USDT, separate explorer and mainnet chain ID',()=>{
  assert.equal(polygonNetwork(137).testnet,false);
  assert.equal(polygonNetwork('137').explorerUrl,'https://polygonscan.com');
  assert.equal(polygonNetwork('').chainId,80002);
  assert.equal(polygonUsdtAddress,POLYGON_USDT);
  for(const value of [1,56,0,'invalid',null])assert.throws(()=>polygonNetwork(value));
  for(const env of [{NUXT_EVM_CHAIN_ID:'80002'},{NUXT_PUBLIC_CHAIN_ID:'80002'},{NUXT_EVM_TOKEN_ADDRESS:Wallet.createRandom().address},{MAINNET_MAX_DEPLOYMENT_COST_POL:'0'},{NUXT_REFERRAL_MIN_CONFIRMATIONS:'1'}])assert.throws(()=>mainnetConfig(env));
});
test('mainnet compilation only produces the distributor and never a mock token',()=>{
  assert.deepEqual(Object.keys(compileContracts({distributorOnly:true})),['ReferralDistributor']);
});
test('wallet sign-in and purchase signatures explicitly bind chain 137',async()=>{
  const wallet=Wallet.createRandom(),authority=Wallet.createRandom(),contract=Wallet.createRandom().address;
  const message=walletChallengeMessage('https://example.com',wallet.address,'a'.repeat(48),Date.now(),'login',137);
  assert.ok(message.includes('Chain ID: 137\n'));
  assert.ok(verifyWalletChallenge(message,wallet.address,await wallet.signMessage(message)));
  assert.ok(!verifyWalletChallenge(message.replace('137','80002'),wallet.address,await wallet.signMessage(message)));
  const reader=new ReferralChainClient({chainId:137,rpcUrl:'http://127.0.0.1:1',contractAddress:contract,tokenAddress:POLYGON_USDT,authorityPrivateKey:authority.privateKey,minConfirmations:2});
  try {
    const quote={id:ZeroHash,buyer:wallet.address,level:1,previousLevel:0,uplinesHash:ZeroHash,feeRecipient:Wallet.createRandom().address,configNonce:'0',deadline:10000000000,matrixCycle:ZeroHash,sponsor:ZeroAddress,qualifiedMask:0};
    const signature=await reader.sign(quote);
    const domain={name:'UNXO Referral Distributor',version:'1',chainId:137,verifyingContract:contract};
    assert.equal(verifyTypedData(domain,purchaseTypes,quote,signature),authority.address);
    assert.notEqual(verifyTypedData({...domain,chainId:80002},purchaseTypes,quote,signature),authority.address);
  }finally{reader.provider.destroy();}
});
test('mainnet source verification targets Etherscan chain 137',async()=>{
  const verifier=new EtherscanVerifier({apiKey:'test-key',chainId:137,fetcher:async url=>{
    assert.equal(url.searchParams.get('chainid'),'137');
    return Response.json({status:'1',result:[{SourceCode:'verified source'}]});
  }});
  assert.deepEqual(await verifier.verify({address:Wallet.createRandom().address}),{status:'already_verified'});
});
