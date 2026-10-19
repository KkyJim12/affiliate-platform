import assert from 'node:assert/strict';
import { test } from 'node:test';
import { network } from 'hardhat';
import { BrowserProvider, ContractFactory, FeeData, Transaction, Wallet, ZeroAddress, parseEther, toBeHex } from 'ethers';
import { EvmSendClient, sendPlanHash, sendUnits } from '../server/lib/evm-send.ts';
import { compileContracts } from '../scripts/lib/compile-contracts.mjs';

const artifacts = compileContracts({ includeTests: true });
async function fixture(decimals = 6, confirmations = 1) {
  const connection = await network.create();
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  const signer = Wallet.createRandom(), recipient = Wallet.createRandom().address;
  const token = await new ContractFactory(artifacts.TestPaymentToken.abi, artifacts.TestPaymentToken.bytecode, await provider.getSigner(0)).deploy(decimals);
  await token.waitForDeployment();
  await provider.send('hardhat_setBalance', [signer.address, toBeHex(parseEther('1'))]);
  await (await token.mint(signer.address, 100n * 10n ** BigInt(decimals))).wait();
  const config = { rpcUrl: 'http://127.0.0.1:8545', chainId: 80002, tokenAddress: await token.getAddress(), minConfirmations: confirmations };
  return { provider, signer, recipient, token, config, client: new EvmSendClient(config, provider),
    close: async () => { provider.destroy(); await connection.close(); } };
}

test('amounts use exact integers and review hashes survive JSONB key reordering', () => {
  assert.equal(sendUnits('9007199254740993.000001', 6), 9007199254740993000001n);
  for (const input of ['0', '-1', '1e3', 'NaN', ' 1', '1.0000001', '1,2', '1.']) assert.throws(() => sendUnits(input, 6));
  const a = { sender: 'a', tx: { nonce: 2, data: '0x' }, amount: '1' };
  assert.equal(sendPlanHash(a), sendPlanHash({ amount: '1', tx: { data: '0x', nonce: 2 }, sender: 'a' }));
  assert.notEqual(sendPlanHash(a), sendPlanHash({ ...a, amount: '2' }));
});

for (const decimals of [6, 18]) test(`native POL and ${decimals}-decimal tokens transfer exact amounts without approvals`, async () => {
  const f = await fixture(decimals);
  try {
    for (const asset of ['native', 'token']) {
      const amount = asset === 'native' ? '0.001234567890123456' : decimals === 6 ? '12.345678' : '12.345678901234567891';
      const before = await f.provider.getBalance(f.signer.address), plan = await f.client.quote(f.signer.address, f.recipient, asset, amount);
      const prepared = await f.client.prepare(f.signer, plan), decoded = Transaction.from(prepared.raw);
      assert.equal(decoded.chainId, 80002n); assert.equal(decoded.from, f.signer.address);
      assert.equal(decoded.to, asset === 'native' ? f.recipient : await f.token.getAddress());
      assert.equal(decoded.value, asset === 'native' ? sendUnits(amount, 18) : 0n);
      await f.client.broadcast(prepared.raw, plan);
      const result = await f.client.verify(prepared.hash, plan);
      assert.equal(result.status, 'confirmed');
      assert.equal(before - await f.provider.getBalance(f.signer.address), decoded.value + result.receipt.fee);
      if (asset === 'native') assert.equal(await f.provider.getBalance(f.recipient), sendUnits(amount, 18));
      else assert.equal(await f.token.balanceOf(f.recipient), sendUnits(amount, decimals));
      await f.client.broadcast(prepared.raw, plan);
      assert.equal(await f.provider.getTransactionCount(f.signer.address), asset === 'native' ? 1 : 2);
    }
    assert.equal(await f.token.allowance(f.signer.address, f.recipient), 0n);
  } finally { await f.close(); }
});

test('invalid recipients, precision, low funds and unsupported chain fail before signing', async () => {
  const f = await fixture();
  try {
    for (const recipient of ['broken', ZeroAddress, f.signer.address, await f.token.getAddress()])
      await assert.rejects(f.client.quote(f.signer.address, recipient, 'native', '0.01'), /recipient/);
    await assert.rejects(f.client.quote(f.signer.address, f.recipient, 'token', '1.0000001'), /amount/);
    await assert.rejects(f.client.quote(f.signer.address, f.recipient, 'token', '101'), /balance/);
    await assert.rejects(f.client.quote(f.signer.address, f.recipient, 'native', '1'), /gas/);
    await f.provider.send('hardhat_setBalance', [f.signer.address, '0x0']);
    await assert.rejects(f.client.quote(f.signer.address, f.recipient, 'token', '1'), /gas/);
    assert.throws(() => new EvmSendClient({ ...f.config, chainId: 1 }, f.provider), /configuration/);
    const nativeOnly = new EvmSendClient({ ...f.config, tokenAddress: '' }, f.provider);
    await assert.rejects(nativeOnly.quote(f.signer.address, f.recipient, 'token', '1'), /token/);
  } finally { await f.close(); }
});

test('expired quotes, changed nonce/fees, wrong signer and altered signed recipients cannot be submitted', async () => {
  const f = await fixture();
  try {
    const plan = await f.client.quote(f.signer.address, f.recipient, 'native', '0.01');
    await assert.rejects(f.client.prepare(f.signer, { ...plan, deadline: Date.now() - 1 }), /expired/);
    await assert.rejects(f.client.prepare(Wallet.createRandom(), plan), /expired/);
    const signed = await f.client.prepare(f.signer, plan);
    await assert.rejects(f.client.broadcast(signed.raw, { ...plan, recipient: Wallet.createRandom().address }), /quote/);
    await assert.rejects(f.client.broadcast(await f.signer.signTransaction({ ...plan.tx, value: 1n }), plan), /quote/);
    const originalFees = f.provider.getFeeData.bind(f.provider), fees = await originalFees();
    f.provider.getFeeData = async () => new FeeData(fees.gasPrice, fees.maxFeePerGas * 2n, fees.maxPriorityFeePerGas);
    await assert.rejects(f.client.prepare(f.signer, plan), /expired/);
    f.provider.getFeeData = originalFees;
    await f.client.broadcast(signed.raw, plan);
    await assert.rejects(f.client.prepare(f.signer, plan), /expired/);
  } finally { await f.close(); }
});

test('minimum confirmations and exact token receipt evidence gate settlement', async () => {
  const f = await fixture(6, 2);
  try {
    const plan = await f.client.quote(f.signer.address, f.recipient, 'token', '1');
    const signed = await f.client.prepare(f.signer, plan);
    await f.client.broadcast(signed.raw, plan);
    assert.equal(await f.client.verify(signed.hash, plan), null);
    await f.provider.send('evm_mine', []);
    assert.equal((await f.client.verify(signed.hash, plan)).status, 'confirmed');
    await f.token.setChargeFee(true);
    const changed = await f.client.quote(f.signer.address, f.recipient, 'token', '1'), next = await f.client.prepare(f.signer, changed);
    await f.client.broadcast(next.raw, changed); await f.provider.send('evm_mine', []);
    await assert.rejects(f.client.verify(next.hash, changed), /evidence/);
  } finally { await f.close(); }
});

test('on-chain reverts settle as failed and never as a successful send', async () => {
  const f = await fixture();
  try {
    const plan = await f.client.quote(f.signer.address, f.recipient, 'token', '1');
    const signed = await f.client.prepare(f.signer, plan);
    await (await f.token.setBlocked(f.recipient)).wait();
    try { await f.client.broadcast(signed.raw, plan); } catch { /* hardhat may throw after mining a reverted transaction */ }
    assert.equal((await f.client.verify(signed.hash, plan)).status, 'failed');
    assert.equal(await f.token.balanceOf(f.recipient), 0n);
  } finally { await f.close(); }
});
