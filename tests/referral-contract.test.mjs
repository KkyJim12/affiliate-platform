import assert from 'node:assert/strict';
import { test } from 'node:test';
import { network } from 'hardhat';
import { AbiCoder, BrowserProvider, ContractFactory, Interface, Wallet, ZeroAddress, id, keccak256 } from 'ethers';
import { compileContracts } from '../scripts/lib/compile-contracts.mjs';
import { purchaseTypes, referralContractAbi } from '../shared/referral-contract.ts';
import { purchaseShares } from '../shared/compensation.ts';

const artifacts = compileContracts({ includeTests: true });
async function fixture(decimals = 6) {
  const connection = await network.create();
  const provider = new BrowserProvider(connection.provider, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const accounts = await Promise.all(Array.from({ length: 20 }, (_, index) => provider.getSigner(index)));
  const [owner, buyer] = accounts, fee = accounts[19], authority = Wallet.createRandom();
  const deploy = async (artifact, args) => {
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode, owner).deploy(...args);
    await contract.waitForDeployment(); return contract;
  };
  const token = await deploy(artifacts.TestPaymentToken, [decimals]);
  const contract = await deploy(artifacts.ReferralDistributor, [await token.getAddress(), await owner.getAddress(), await fee.getAddress(), authority.address]);
  const uplines = await Promise.all(accounts.slice(2, 17).map(account => account.getAddress()));
  const multiplier = 10n ** BigInt(decimals - 6);
  await (await token.mint(await buyer.getAddress(), 400000n * 10n ** BigInt(decimals))).wait();
  async function quote(level = 1, changes = {}, ancestors = uplines, signingWallet = authority) {
    const value = { id: id(`purchase-${Math.random()}`), buyer: await buyer.getAddress(), level, previousLevel: level - 1,
      uplinesHash: keccak256(AbiCoder.defaultAbiCoder().encode(['address[15]'], [ancestors])), feeRecipient: await fee.getAddress(),
      configNonce: String(await contract.configNonce()), deadline: (await provider.getBlock('latest')).timestamp + 3600, ...changes };
    return { value, uplines: ancestors, signature: await signingWallet.signTypedData(
      { name: 'UNXO Referral Distributor', version: '1', chainId: 80002, verifyingContract: await contract.getAddress() }, purchaseTypes, value) };
  }
  async function buy(signed) {
    await (await token.connect(buyer).approve(await contract.getAddress(), await contract.priceForLevel(signed.value.level))).wait();
    return (await contract.connect(buyer).purchase(signed.value, signed.uplines, signed.signature)).wait();
  }
  return { provider, connection, owner, buyer, fee, authority, token, contract, uplines, multiplier, quote, buy,
    close: async () => { provider.destroy(); await connection.close(); } };
}

test('contract ABI matches server selectors and event signatures', () => {
  const compiled = new Interface(artifacts.ReferralDistributor.abi), server = new Interface(referralContractAbi);
  for (const fragment of server.fragments) {
    const reference = fragment.type === 'event' ? compiled.getEvent(fragment.name) : compiled.getFunction(fragment.name);
    assert.equal(fragment.format('sighash'), reference.format('sighash'));
  }
});

test('real token transfers conserve 100% across every level, including 15 normalized bonus shares', async () => {
  const f = await fixture();
  try {
    let spent = 0n;
    for (let level = 1; level <= 15; level++) {
      const signed = await f.quote(level);
      const receipt = await f.buy(signed);
      const expected = purchaseShares(level).map(share => BigInt(share.units));
      assert.deepEqual(Array.from(await f.contract.previewShares(level)), expected);
      assert.equal(await f.contract.levelOf(await f.buyer.getAddress()), BigInt(level));
      assert.equal(await f.contract.purchased(signed.value.id), true);
      assert.equal(await f.token.balanceOf(await f.contract.getAddress()), 0n);
      const events = receipt.logs.flatMap(log => { try { const decoded = f.contract.interface.parseLog(log); return decoded?.name === 'SharePaid' ? [decoded] : []; } catch { return []; } });
      assert.equal(events.length, 19);
      assert.deepEqual(events.map(event => event.args.amount), expected);
      const price = 10_000_000n << BigInt(level - 1);
      spent += price;
      assert.equal(events.reduce((sum, event) => sum + event.args.amount, 0n), price);
    }
    assert.equal(await f.token.balanceOf(await f.buyer.getAddress()), 400000000000n - spent);
    await assert.rejects(f.contract.priceForLevel(16));
  } finally { await f.close(); }
});

test('18-decimal tokens preserve the app micro-USDT rounding and missing shares go to the fee wallet', async () => {
  const f = await fixture(18);
  try {
    const ancestors = [f.uplines[0], ...Array(14).fill(ZeroAddress)];
    const signed = await f.quote(1, {}, ancestors);
    await f.buy(signed);
    const expected = purchaseShares(1).filter(share => share.depth === 1).reduce((sum, share) => sum + BigInt(share.units), 0n) * f.multiplier;
    assert.equal(await f.token.balanceOf(f.uplines[0]), expected);
    assert.equal(await f.token.balanceOf(await f.fee.getAddress()), 10n ** 19n - expected);
    assert.equal(await f.token.balanceOf(await f.contract.getAddress()), 0n);
    assert.deepEqual(Array.from(await f.contract.previewShares(15)), purchaseShares(15).map(share => BigInt(share.units) * f.multiplier));
  } finally { await f.close(); }
});

test('forged recipients/signatures, wrong buyers, replay, stale fees and expired quotes cannot spend funds', async () => {
  const f = await fixture();
  try {
    await (await f.token.connect(f.buyer).approve(await f.contract.getAddress(), 100000000n)).wait();
    const signed = await f.quote();
    const call = (quote = signed.value, uplines = signed.uplines, signature = signed.signature, caller = f.buyer) => f.contract.connect(caller).purchase(quote, uplines, signature);
    await assert.rejects(call({ ...signed.value, deadline: 1 }));
    await assert.rejects(call(signed.value, Array(15).fill(ZeroAddress)));
    await assert.rejects(call(signed.value, signed.uplines, signed.signature, f.owner));
    const forged = await f.quote(1, {}, f.uplines, Wallet.createRandom());
    await assert.rejects(call(forged.value, forged.uplines, forged.signature));
    const expired = await f.quote(1, { deadline: 1 });
    await assert.rejects(call(expired.value, expired.uplines, expired.signature));
    await (await call()).wait();
    await assert.rejects(call());
    const stale = await f.quote(2);
    await (await f.contract.setFeeRecipient(f.uplines[14])).wait();
    await assert.rejects(call(stale.value, stale.uplines, stale.signature));
    await assert.rejects(f.contract.connect(f.buyer).setFeeRecipient(f.uplines[0]));
    assert.equal(await f.contract.levelOf(await f.buyer.getAddress()), 1n);
    assert.equal(await f.token.balanceOf(await f.buyer.getAddress()), 399990000000n);
  } finally { await f.close(); }
});

test('a failed recipient transfer or fee-on-transfer token reverts every earlier payout and the level', async () => {
  const f = await fixture();
  try {
    const signed = await f.quote();
    await (await f.token.setBlocked(f.uplines[2])).wait();
    await assert.rejects(f.buy(signed));
    assert.equal(await f.contract.purchased(signed.value.id), false);
    assert.equal(await f.contract.levelOf(await f.buyer.getAddress()), 0n);
    assert.equal(await f.token.balanceOf(f.uplines[0]), 0n);
    assert.equal(await f.token.balanceOf(await f.buyer.getAddress()), 400000000000n);
    await (await f.token.setBlocked(ZeroAddress)).wait();
    await (await f.token.setChargeFee(true)).wait();
    await assert.rejects(f.buy(signed));
    assert.equal(await f.token.balanceOf(await f.buyer.getAddress()), 400000000000n);
    assert.equal(await f.contract.purchased(signed.value.id), false);
  } finally { await f.close(); }
});

test('signed legacy level bootstrapping, sequential upgrades, pause and duplicate-upline protections', async () => {
  const f = await fixture();
  try {
    await f.buy(await f.quote(4));
    assert.equal(await f.contract.levelOf(await f.buyer.getAddress()), 4n);
    await assert.rejects(f.buy(await f.quote(6)));
    await (await f.contract.setPaused(true)).wait();
    await assert.rejects(f.buy(await f.quote(5)));
    await (await f.contract.setPaused(false)).wait();
    const duplicate = [...f.uplines]; duplicate[1] = duplicate[0];
    await assert.rejects(f.buy(await f.quote(5, {}, duplicate)));
    const self = [...f.uplines]; self[0] = await f.buyer.getAddress();
    await assert.rejects(f.buy(await f.quote(5, {}, self)));
    await f.buy(await f.quote(5));
    assert.equal(await f.contract.levelOf(await f.buyer.getAddress()), 5n);
  } finally { await f.close(); }
});
