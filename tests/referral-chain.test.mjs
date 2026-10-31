import assert from 'node:assert/strict';
import { test } from 'node:test';
import { network } from 'hardhat';
import { BrowserProvider, ContractFactory, FeeData, Transaction, Wallet, ZeroAddress, ZeroHash, id, parseEther, parseUnits, toBeHex } from 'ethers';
import { ReferralChainClient, uplineHash } from '../server/lib/referral-chain.ts';
import { compileContracts } from '../scripts/lib/compile-contracts.mjs';

const artifacts = compileContracts({ includeTests: true });
async function fixture({ confirmations = 1, funds = 100n, decimals = 6 } = {}) {
  const connection = await network.create();
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  const deployer = await provider.getSigner(0), buyer = Wallet.createRandom(), authority = Wallet.createRandom(), fee = Wallet.createRandom();
  const token = await new ContractFactory(artifacts.TestPaymentToken.abi, artifacts.TestPaymentToken.bytecode, deployer).deploy(decimals);
  await token.waitForDeployment();
  const contract = await new ContractFactory(artifacts.ReferralDistributor.abi, artifacts.ReferralDistributor.bytecode, deployer)
    .deploy(await token.getAddress(), await deployer.getAddress(), fee.address, authority.address);
  await contract.waitForDeployment();
  await provider.send('hardhat_setBalance', [buyer.address, toBeHex(parseEther('100'))]);
  if (funds) await (await token.mint(buyer.address, funds * 10n ** BigInt(decimals))).wait();
  const config = { rpcUrl: 'http://127.0.0.1:8545', contractAddress: await contract.getAddress(), tokenAddress: await token.getAddress(), authorityPrivateKey: authority.privateKey, minConfirmations: confirmations };
  const client = new ReferralChainClient(config, provider);
  const uplines = Array(18).fill(ZeroAddress);
  const quote = { id: id(`library-${Math.random()}`), buyer: buyer.address, level: 1, previousLevel: 0, uplinesHash: uplineHash(uplines), feeRecipient: fee.address,
    configNonce: '0', deadline: (await provider.getBlock('latest')).timestamp + 3600, matrixCycle: ZeroHash, sponsor: ZeroAddress, qualifiedMask:(1<<19)-1, sponsorExempt:true };
  const payload = { createdBlock: (await provider.getBlock('latest')).number, quote, uplines, recipients: uplines.map(() => ({ userId: null, reason: 'missing_upline' })), signature: await client.sign(quote) };
  return { connection, provider, buyer, token, contract, client, payload, fee, config, close: async () => { provider.destroy(); await connection.close(); } };
}

test('an older deployment without the new distribution version cannot accept new quotes', async () => {
  const f = await fixture();
  try {
    const call = f.provider.call.bind(f.provider), selector = f.contract.interface.getFunction('distributionVersion').selector;
    f.provider.call = async request => request.data?.startsWith(selector) ? '0x' : call(request);
    await assert.rejects(f.client.inspect(f.buyer.address,1,false), /Deploy the updated referral contract/);
  } finally { await f.close(); }
});

test('receipt verification distinguishes held shares from payments and records automatic release on the second referral',async()=>{
  const f=await fixture();
  try {
    const sponsor=Wallet.createRandom().address,uplines=Array(18).fill(ZeroAddress);uplines[0]=sponsor;uplines[3]=sponsor;
    const recipients=uplines.map(address=>({userId:address===sponsor?'sponsor-user':null,reason:address===sponsor?'upline':'missing_upline'}));
    const quote={...f.payload.quote,sponsor,qualifiedMask:0,uplinesHash:uplineHash(uplines)};
    const payload={...f.payload,quote,uplines,recipients,signature:await f.client.sign(quote)};
    const first=await f.client.preparePurchase(f.buyer,payload,6);
    for(const tx of first) await f.client.broadcast(tx.raw);
    const held=await f.client.verifyPurchase(first.at(-1).hash,payload);
    assert.equal(held.allocations.filter(row=>row.held).length,2);assert.deepEqual(held.releases,[]);
    assert.equal(await f.token.balanceOf(sponsor),0n);
    assert.equal(await f.contract.heldCommissions(sponsor),1_100_000n);
    const second=Wallet.createRandom();
    await f.provider.send('hardhat_setBalance',[second.address,toBeHex(parseEther('1'))]);
    await (await f.token.mint(second.address,10_000_000n)).wait();
    const secondQuote={...quote,id:id('second-paid-referral'),buyer:second.address};
    const secondPayload={...payload,quote:secondQuote,signature:await f.client.sign(secondQuote)};
    const batch=await f.client.preparePurchase(second,secondPayload,6);
    for(const tx of batch) await f.client.broadcast(tx.raw);
    const paid=await f.client.verifyPurchase(batch.at(-1).hash,secondPayload);
    assert.equal(paid.allocations.filter(row=>row.held).length,0);
    assert.equal(paid.releases.length,1);assert.equal(paid.releases[0].amount,'1100000');assert.equal(paid.releases[0].recipient,sponsor);
    assert.equal(await f.token.balanceOf(sponsor),2_200_000n);
    assert.equal(await f.contract.totalHeldCommissions(),0n);
  } finally {await f.close();}
});

test('signed legacy qualification releases held commissions without a new purchase and survives rebroadcast',async()=>{
  const f=await fixture();
  try {
    const sponsor=Wallet.createRandom().address,uplines=Array(18).fill(ZeroAddress);uplines[0]=sponsor;uplines[3]=sponsor;
    const quote={...f.payload.quote,sponsor,qualifiedMask:0,uplinesHash:uplineHash(uplines)};
    const payload={...f.payload,quote,uplines,signature:await f.client.sign(quote)};
    for(const tx of await f.client.preparePurchase(f.buyer,payload,6)) await f.client.broadcast(tx.raw);
    await f.provider.send('hardhat_setBalance',[f.client.authority.address,toBeHex(parseEther('1'))]);
    // The server separately verifies two paid database referrals before issuing
    // this attestation, including accounts paid before linking their sponsor.
    const proof=await f.client.prepareQualification(sponsor),value=proof.payload;
    const sender=await f.provider.getSigner(0);
    await assert.rejects(f.contract.connect(sender).qualifyCommission(Wallet.createRandom().address,value.configNonce,value.signature));
    await assert.rejects(f.contract.connect(sender).qualifyCommission(sponsor,'1',value.signature));
    const tx=proof.prepared[0];await f.client.broadcast(tx.raw);
    const evidence=await f.client.verifyQualification(tx.hash,value);
    assert.equal(evidence.status,'confirmed');assert.equal(evidence.releases[0].amount,'1100000');
    assert.equal(await f.token.balanceOf(sponsor),1_100_000n);
    assert.equal(await f.contract.totalHeldCommissions(),0n);
    await f.client.broadcast(tx.raw);
    await (await f.contract.connect(sender).qualifyCommission(sponsor,value.configNonce,value.signature)).wait();
    assert.equal(await f.token.balanceOf(sponsor),1_100_000n);
    await assert.rejects(f.client.verifyQualification(tx.hash,{...value,member:Wallet.createRandom().address}),/authorization/);
  } finally {await f.close();}
});

test('relayed rebirth receipts verify the debit, new uplines and exact method, including replacement recovery',async()=>{
  const f=await fixture();
  try {
    for(const tx of await f.client.preparePurchase(f.buyer,f.payload,6)) await f.client.broadcast(tx.raw);
    await (await f.token.connect(f.buyer.connect(f.provider)).approve(f.config.contractAddress,10_000_000n)).wait();
    await f.provider.send('hardhat_setBalance',[f.client.authority.address,toBeHex(parseEther('1'))]);
    const quote={...f.payload.quote,id:id('library-rebirth'),previousLevel:1,matrixCycle:id('library-completion')};
    const payload={...f.payload,quote,rebirth:true,signature:await f.client.sign(quote)};
    const batch=await f.client.prepareAutoUpgrade(payload,6);
    for(const tx of batch) await f.client.broadcast(tx.raw);
    const evidence=await f.client.verifyPurchase(null,payload);
    assert.equal(evidence.status,'confirmed');
    assert.equal(evidence.allocations.reduce((sum,share)=>sum+share.units,0),10_000_000);
    assert.equal(await f.token.balanceOf(f.buyer.address),80_000_000n);
    assert.equal(await f.contract.levelOf(f.buyer.address),1n);
    await assert.rejects(f.client.verifyPurchase(batch[0].hash,{...payload,rebirth:false}),/authorization/);
  } finally {await f.close();}
});

test('signed purchase batches bind chain, spender, exact allowance and nonce order without a gas quote', async () => {
  const f = await fixture();
  try {
    const state = await f.client.inspect(f.buyer.address);
    assert.equal(state.balance, '100.0'); assert.equal(state.currentLevel, 0);
    const batch = await f.client.preparePurchase(f.buyer, f.payload, 6);
    assert.deepEqual(batch.map(item => item.stage), ['approval', 'purchase']);
    assert.equal(batch[1].nonce, batch[0].nonce + 1);
    for (const item of batch) {
      const decoded = Transaction.from(item.raw);
      assert.equal(decoded.chainId, 80002n); assert.equal(decoded.from, f.buyer.address); assert.equal(decoded.value, 0n);
      await f.client.broadcast(item.raw);
    }
    const evidence = await f.client.verifyPurchase(batch[1].hash, f.payload);
    assert.equal(evidence.status, 'confirmed'); assert.equal(evidence.allocations.length, 19);
    assert.equal(evidence.allocations.reduce((sum, share) => sum + share.units, 0), 10_000_000);
    assert.equal(await f.token.balanceOf(f.fee.address), 10_000_000n);
    await f.client.broadcast(batch[1].raw);
    assert.equal(await f.token.balanceOf(f.fee.address), 10_000_000n);
    await assert.rejects(f.client.verifyPurchase(batch[1].hash, { ...f.payload, quote: { ...f.payload.quote, level: 2 } }), /authorization/);
  } finally { await f.close(); }
});

for (const decimals of [6, 18]) test(`purchases below the old POL minimum fund all 18 cold recipients for a ${decimals}-decimal token`, async () => {
  const f = await fixture({ decimals });
  try {
    const fee = parseUnits('1', 'gwei');
    f.provider.getFeeData = async () => new FeeData(fee, fee, fee);
    const uplines = Array.from({ length: 18 }, () => Wallet.createRandom().address);
    f.payload.uplines = uplines;
    f.payload.quote.uplinesHash = uplineHash(uplines);
    f.payload.recipients = uplines.map(() => ({ userId: null, reason: 'upline' }));
    f.payload.signature = await f.client.sign(f.payload.quote);
    assert.equal((await f.client.inspect(f.buyer.address)).gasBudget, '0.003');
    await f.provider.send('hardhat_setBalance', [f.buyer.address, toBeHex(parseEther('0.003') - 1n)]);
    const batch = await f.client.preparePurchase(f.buyer, f.payload, decimals);
    const decoded = batch.map(item => Transaction.from(item.raw));
    assert.deepEqual(decoded.map(tx => tx.gasLimit), [60_000n, 1_400_000n]);
    assert.ok(decoded.reduce((total, tx) => total + tx.gasLimit * tx.maxFeePerGas, 0n) <= parseEther('0.003'));
    for (const item of batch) await f.client.broadcast(item.raw);
    const evidence = await f.client.verifyPurchase(batch.at(-1).hash, f.payload);
    assert.equal(evidence.status, 'confirmed'); assert.equal(evidence.allocations.length, 19);
    for (const upline of uplines) assert.ok(await f.token.balanceOf(upline) > 0n);
  } finally { await f.close(); }
});

test('purchases use current fees without checking the native balance or requiring an updated gas quote', async () => {
  const f = await fixture();
  try {
    const fee = parseUnits('30', 'gwei');
    f.provider.getFeeData = async () => new FeeData(fee, fee, fee);
    await (await f.token.connect(f.buyer.connect(f.provider)).approve(await f.contract.getAddress(), 15_000_000n)).wait();
    assert.equal((await f.client.inspect(f.buyer.address, 1)).gasBudget, '0.0483');
    assert.equal((await f.client.inspect(f.buyer.address, 2)).gasBudget, '0.05244');
    const higherFee = parseUnits('60', 'gwei');
    f.provider.getFeeData = async () => new FeeData(higherFee, higherFee, fee);
    assert.ok(parseEther((await f.client.inspect(f.buyer.address)).gasBudget) > parseEther('0.003'));
    const configured = new ReferralChainClient({ ...f.config, minGasBalance: '0.05' }, f.provider);
    assert.equal(configured.minimumGasBalance, parseEther('0.05'));
    await f.provider.send('hardhat_setBalance', [f.buyer.address, '0x0']);
    f.provider.getBalance = async () => { throw new Error('Purchases must not read the native balance.'); };
    const batch = await configured.preparePurchase(f.buyer, f.payload, 6);
    assert.equal(Transaction.from(batch[0].raw).maxFeePerGas, higherFee * 115n / 100n);
    assert.throws(() => new ReferralChainClient({ ...f.config, minGasBalance: 'invalid' }, f.provider), /minimum POL/);
  } finally { await f.close(); }
});

test('confirmation policy delays settlement and USDT zero-first approvals execute in the persisted nonce order', async () => {
  const f = await fixture({ confirmations: 3 });
  try {
    await (await f.token.setZeroFirst(true)).wait();
    await (await f.token.connect(f.buyer.connect(f.provider)).approve(await f.contract.getAddress(), 1n)).wait();
    const batch = await f.client.preparePurchase(f.buyer, f.payload, 6);
    assert.deepEqual(batch.map(item => item.stage), ['approval_reset', 'approval', 'purchase']);
    for (const item of batch) await f.client.broadcast(item.raw);
    assert.equal(await f.client.verifyPurchase(batch[2].hash, f.payload), null);
    await f.provider.send('evm_mine', []); await f.provider.send('evm_mine', []);
    assert.equal((await f.client.verifyPurchase(batch[2].hash, f.payload)).status, 'confirmed');
    assert.equal(await f.token.allowance(f.buyer.address, await f.contract.getAddress()), 0n);
  } finally { await f.close(); }
});

test('insufficient tokens and invalid deployment configuration fail before signing; zero POL does not', async () => {
  const f = await fixture({ funds: 0n });
  try {
    await assert.rejects(f.client.preparePurchase(f.buyer, f.payload, 6), /INSUFFICIENT_TOKEN/);
    await (await f.token.mint(f.buyer.address, 10_000_000n)).wait();
    await f.provider.send('hardhat_setBalance', [f.buyer.address, '0x0']);
    const batch = await f.client.preparePurchase(f.buyer, f.payload, 6);
    assert.deepEqual(batch.map(item => item.stage), ['approval', 'purchase']);
    assert.throws(() => new ReferralChainClient({ ...f.config, minConfirmations: 0 }, f.provider));
    assert.throws(() => new ReferralChainClient({ ...f.config, contractAddress: ZeroAddress }, f.provider));
    const wrongAuthority = new ReferralChainClient({ ...f.config, authorityPrivateKey: Wallet.createRandom().privateKey }, f.provider);
    await assert.rejects(wrongAuthority.inspect(f.buyer.address), /configuration/);
  } finally { await f.close(); }
});

test('purchase status loads when native balance and gas-estimate RPC calls are unavailable', async () => {
  const f = await fixture();
  try {
    f.provider.getBalance = async () => { throw new Error('Native balance unavailable.'); };
    f.provider.getFeeData = async () => { throw new Error('Gas estimate unavailable.'); };
    const state = await f.client.inspect(f.buyer.address, 1, false);
    assert.equal(state.balance, '100.0'); assert.equal(state.currentLevel, 0);
    assert.equal(state.paused, false);
    assert.equal(state.gasBalance, null); assert.equal(state.gasBudget, null);
  } finally { await f.close(); }
});

test('administrative fee updates still enforce the gas quote and native balance', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.client.prepareFeeUpdate(f.buyer, f.fee.address, 1n), /GAS_PRICE_CHANGED/);
    await f.provider.send('hardhat_setBalance', [f.buyer.address, '0x0']);
    await assert.rejects(f.client.prepareFeeUpdate(f.buyer, f.fee.address, parseEther('1')), /INSUFFICIENT_GAS/);
  } finally { await f.close(); }
});

test('a gas-price replacement is recovered by its signed purchase ID and verified receipt', async () => {
  const f = await fixture();
  try {
    const batch = await f.client.preparePurchase(f.buyer, f.payload, 6);
    await f.client.broadcast(batch[0].raw);
    const original = Transaction.from(batch[1].raw);
    const replacement = await f.buyer.signTransaction({ to: original.to, data: original.data, chainId: original.chainId,
      nonce: original.nonce, type: 2, value: 0n, gasLimit: original.gasLimit,
      maxFeePerGas: original.maxFeePerGas * 2n, maxPriorityFeePerGas: original.maxPriorityFeePerGas * 2n });
    const sent = await f.provider.broadcastTransaction(replacement); await sent.wait();
    assert.equal(await f.provider.getTransactionReceipt(batch[1].hash), null);
    const verified = await f.client.verifyPurchase(batch[1].hash, f.payload);
    assert.equal(verified.status, 'confirmed'); assert.equal(verified.receipt.hash, sent.hash);
    assert.equal(await f.token.balanceOf(f.fee.address), 10_000_000n);
  } finally { await f.close(); }
});

test('mock Amoy token is six-decimal, one faucet claim covers all 15 levels, and minting is owner-only', async () => {
  const connection = await network.create(), provider = new BrowserProvider(connection.provider);
  try {
    const owner = await provider.getSigner(0), member = await provider.getSigner(1);
    const mock = await new ContractFactory(artifacts.AmoyTestUSDT.abi, artifacts.AmoyTestUSDT.bytecode, owner).deploy(await owner.getAddress());
    await mock.waitForDeployment();
    assert.equal(await mock.decimals(), 6n);
    await (await mock.connect(member).faucet()).wait();
    assert.equal(await mock.balanceOf(await member.getAddress()), 400_000_000_000n);
    await assert.rejects(mock.connect(member).faucet());
    await assert.rejects(mock.connect(member).mint(await member.getAddress(), 1n));
  } finally { provider.destroy(); await connection.close(); }
});

test('automatic approval is finite and relayed upgrade receipts verify against the buyer and cycle', async () => {
 const f=await fixture();
 try {
  f.payload.automaticApproval=true;
  await f.provider.send('hardhat_setBalance',[f.client.authority.address,toBeHex(parseEther('1'))]);
  for(const item of await f.client.preparePurchase(f.buyer,f.payload,6)) await f.client.broadcast(item.raw);
  assert.equal(await f.token.allowance(f.buyer.address,f.config.contractAddress),327660000000n);
  const block=await f.provider.getBlock('latest');
  const quote={...f.payload.quote,id:id('relayed-upgrade'),level:2,previousLevel:1,matrixCycle:id('matrix-cycle-1'),deadline:block.timestamp+3600};
  const payload={...f.payload,createdBlock:block.number,quote,signature:await f.client.sign(quote)};
  const batch=await f.client.prepareAutoUpgrade(payload,6);
  assert.equal(Transaction.from(batch[0].raw).from,f.client.authority.address);
  await f.client.broadcast(batch[0].raw);
  const evidence=await f.client.verifyPurchase(batch[0].hash,payload);
  assert.equal(evidence.status,'confirmed'); assert.equal(evidence.allocations.length,19);
  assert.equal(await f.contract.levelOf(f.buyer.address),2n);
  assert.equal(await f.token.balanceOf(f.buyer.address),70000000n);
 } finally { await f.close(); }
});
