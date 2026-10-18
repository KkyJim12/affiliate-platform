import assert from 'node:assert/strict';
import { test } from 'node:test';
import { network } from 'hardhat';
import { BrowserProvider, ContractFactory, Transaction, Wallet, ZeroAddress, id, parseEther, toBeHex } from 'ethers';
import { ReferralChainClient, uplineHash } from '../server/lib/referral-chain.ts';
import { compileContracts } from '../scripts/lib/compile-contracts.mjs';

const artifacts = compileContracts({ includeTests: true });
async function fixture({ confirmations = 1, funds = 100n } = {}) {
  const connection = await network.create();
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  const deployer = await provider.getSigner(0), buyer = Wallet.createRandom(), authority = Wallet.createRandom(), fee = Wallet.createRandom();
  const token = await new ContractFactory(artifacts.TestPaymentToken.abi, artifacts.TestPaymentToken.bytecode, deployer).deploy(6);
  await token.waitForDeployment();
  const contract = await new ContractFactory(artifacts.ReferralDistributor.abi, artifacts.ReferralDistributor.bytecode, deployer)
    .deploy(await token.getAddress(), await deployer.getAddress(), fee.address, authority.address);
  await contract.waitForDeployment();
  await provider.send('hardhat_setBalance', [buyer.address, toBeHex(parseEther('100'))]);
  if (funds) await (await token.mint(buyer.address, funds * 1_000_000n)).wait();
  const config = { rpcUrl: 'http://127.0.0.1:8545', contractAddress: await contract.getAddress(), tokenAddress: await token.getAddress(), authorityPrivateKey: authority.privateKey, minConfirmations: confirmations };
  const client = new ReferralChainClient(config, provider);
  const uplines = Array(15).fill(ZeroAddress);
  const quote = { id: id(`library-${Math.random()}`), buyer: buyer.address, level: 1, previousLevel: 0, uplinesHash: uplineHash(uplines), feeRecipient: fee.address,
    configNonce: '0', deadline: (await provider.getBlock('latest')).timestamp + 3600 };
  const payload = { createdBlock: (await provider.getBlock('latest')).number, quote, uplines, recipients: uplines.map(() => ({ userId: null, reason: 'missing_upline' })), signature: await client.sign(quote) };
  return { connection, provider, buyer, token, contract, client, payload, fee, config, close: async () => { provider.destroy(); await connection.close(); } };
}

test('signed purchase batches bind chain, spender, exact allowance, nonce order and a caller-authorized gas cap', async () => {
  const f = await fixture();
  try {
    const state = await f.client.inspect(f.buyer.address);
    assert.equal(state.balance, '100.0'); assert.equal(state.currentLevel, 0);
    await assert.rejects(f.client.preparePurchase(f.buyer, f.payload, 6, 1n), /GAS_PRICE_CHANGED/);
    const batch = await f.client.preparePurchase(f.buyer, f.payload, 6, parseEther('1'));
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

test('confirmation policy delays settlement and USDT zero-first approvals execute in the persisted nonce order', async () => {
  const f = await fixture({ confirmations: 3 });
  try {
    await (await f.token.setZeroFirst(true)).wait();
    await (await f.token.connect(f.buyer.connect(f.provider)).approve(await f.contract.getAddress(), 1n)).wait();
    const batch = await f.client.preparePurchase(f.buyer, f.payload, 6, parseEther('1'));
    assert.deepEqual(batch.map(item => item.stage), ['approval_reset', 'approval', 'purchase']);
    for (const item of batch) await f.client.broadcast(item.raw);
    assert.equal(await f.client.verifyPurchase(batch[2].hash, f.payload), null);
    await f.provider.send('evm_mine', []); await f.provider.send('evm_mine', []);
    assert.equal((await f.client.verifyPurchase(batch[2].hash, f.payload)).status, 'confirmed');
    assert.equal(await f.token.allowance(f.buyer.address, await f.contract.getAddress()), 0n);
  } finally { await f.close(); }
});

test('insufficient token/gas and invalid deployment configuration fail before signing transactions', async () => {
  const f = await fixture({ funds: 0n });
  try {
    await assert.rejects(f.client.preparePurchase(f.buyer, f.payload, 6, parseEther('1')), /INSUFFICIENT_TOKEN/);
    await (await f.token.mint(f.buyer.address, 10_000_000n)).wait();
    await f.provider.send('hardhat_setBalance', [f.buyer.address, '0x0']);
    await assert.rejects(f.client.preparePurchase(f.buyer, f.payload, 6, parseEther('1')), /INSUFFICIENT_GAS/);
    assert.throws(() => new ReferralChainClient({ ...f.config, minConfirmations: 0 }, f.provider));
    assert.throws(() => new ReferralChainClient({ ...f.config, contractAddress: ZeroAddress }, f.provider));
    const wrongAuthority = new ReferralChainClient({ ...f.config, authorityPrivateKey: Wallet.createRandom().privateKey }, f.provider);
    await assert.rejects(wrongAuthority.inspect(f.buyer.address), /configuration/);
  } finally { await f.close(); }
});

test('a gas-price replacement is recovered by its signed purchase ID and verified receipt', async () => {
  const f = await fixture();
  try {
    const batch = await f.client.preparePurchase(f.buyer, f.payload, 6, parseEther('1'));
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
