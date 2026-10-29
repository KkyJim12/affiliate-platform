import assert from 'node:assert/strict';
import { test } from 'node:test';
import { network } from 'hardhat';
import { AbiCoder, BrowserProvider, ContractFactory, Interface, Wallet, ZeroAddress, ZeroHash, id, keccak256 } from 'ethers';
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
  const parents = await Promise.all(accounts.slice(2, 17).map(account => account.getAddress()));
  const uplines = [...parents.slice(0,3),...parents];
  const multiplier = 10n ** BigInt(decimals - 6);
  await (await token.mint(await buyer.getAddress(), 400000n * 10n ** BigInt(decimals))).wait();
  async function quote(level = 1, changes = {}, ancestors = uplines, signingWallet = authority) {
    const value = { id: id(`purchase-${Math.random()}`), buyer: await buyer.getAddress(), level, previousLevel: level - 1,
      uplinesHash: keccak256(AbiCoder.defaultAbiCoder().encode(['address[18]'], [ancestors])), feeRecipient: await fee.getAddress(),
      configNonce: String(await contract.configNonce()), deadline: (await provider.getBlock('latest')).timestamp + 3600, matrixCycle: ZeroHash, sponsor: ZeroAddress, qualifiedMask: (1<<19)-1, ...changes };
    return { value, uplines: ancestors, signature: await signingWallet.signTypedData(
      { name: 'UNXO Referral Distributor', version: '1', chainId: 80002, verifyingContract: await contract.getAddress() }, purchaseTypes, value) };
  }
  async function buy(signed) {
    await (await token.connect(buyer).approve(await contract.getAddress(), await contract.priceForLevel(signed.value.level))).wait();
    return (await contract.connect(buyer).purchase(signed.value, signed.uplines, signed.signature, { gasLimit: 1_400_000n })).wait();
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

for(const decimals of [6,18]) test(`commissions stay in the contract until two distinct paid direct referrals, then release once (${decimals} decimals)`,async()=>{
  const f=await fixture(decimals);
  try {
    const sponsor=f.uplines[0],ancestors=Array(18).fill(ZeroAddress);ancestors[0]=sponsor;ancestors[3]=sponsor;
    const first=await f.quote(1,{sponsor,qualifiedMask:0},ancestors);
    await assert.rejects(f.buy({...first,value:{...first.value,qualifiedMask:1}}));
    await assert.rejects(f.buy({...first,value:{...first.value,sponsor:f.uplines[1]}}));
    await f.buy(first);
    assert.equal(await f.contract.paidDirectReferrals(sponsor),1n);
    assert.equal(await f.contract.heldCommissions(sponsor),1_100_000n*f.multiplier);
    assert.equal(await f.token.balanceOf(sponsor),0n);
    await f.buy(await f.quote(2,{sponsor,qualifiedMask:0},ancestors));
    const rebirth=await f.quote(1,{sponsor,qualifiedMask:0,previousLevel:2,matrixCycle:id('qualification-rebirth')},ancestors);
    await (await f.token.connect(f.buyer).approve(await f.contract.getAddress(),10_000_000n*f.multiplier)).wait();
    await (await f.contract.connect(f.owner).rebirth(rebirth.value,ancestors,rebirth.signature)).wait();
    assert.equal(await f.contract.paidDirectReferrals(sponsor),1n);
    const held=4_400_000n*f.multiplier;
    assert.equal(await f.contract.heldCommissions(sponsor),held);
    assert.equal(await f.token.balanceOf(await f.contract.getAddress()),held);
    const second=await f.provider.getSigner(18),secondAddress=await second.getAddress();
    await (await f.token.mint(secondAddress,10_000_000n*f.multiplier)).wait();
    await (await f.token.connect(second).approve(await f.contract.getAddress(),10_000_000n*f.multiplier)).wait();
    const signed=await f.quote(1,{buyer:secondAddress,sponsor,qualifiedMask:0},ancestors);
    const pay=()=>f.contract.connect(second).purchase(signed.value,ancestors,signed.signature);
    await (await f.token.setBlocked(sponsor)).wait();
    await assert.rejects(pay());
    assert.equal(await f.contract.paidDirectReferrals(sponsor),1n);
    assert.equal(await f.contract.heldCommissions(sponsor),held);
    assert.equal(await f.contract.levelOf(secondAddress),0n);
    await (await f.token.setBlocked(ZeroAddress)).wait();
    const receipt=await (await pay()).wait();
    const released=receipt.logs.flatMap(log=>{try {const event=f.contract.interface.parseLog(log);return event?.name==='HeldCommissionReleased'?[event]:[];}catch{return [];}});
    assert.equal(released.length,1);assert.equal(released[0].args.amount,held);
    assert.equal(await f.contract.paidDirectReferrals(sponsor),2n);
    assert.equal(await f.contract.commissionQualified(sponsor),true);
    assert.equal(await f.token.balanceOf(sponsor),5_500_000n*f.multiplier);
    assert.equal(await f.contract.heldCommissions(sponsor),0n);
    assert.equal(await f.contract.totalHeldCommissions(),0n);
    assert.equal(await f.token.balanceOf(await f.contract.getAddress()),0n);
    await assert.rejects(pay());
    await f.buy(await f.quote(3,{sponsor,qualifiedMask:0},ancestors));
    assert.equal(await f.contract.paidDirectReferrals(sponsor),2n);
    assert.equal(await f.token.balanceOf(sponsor),9_900_000n*f.multiplier);
  } finally {await f.close();}
});

test('all fifteen levels retain every unqualified commission while paying only the platform fee',async()=>{
  const f=await fixture();
  try {
    let held=0n,fees=0n;
    for(let level=1;level<=15;level++) {
      const price=10_000_000n<<BigInt(level-1);
      await f.buy(await f.quote(level,{qualifiedMask:0}));
      held+=price*95n/100n;fees+=price/20n;
      assert.equal(await f.contract.totalHeldCommissions(),held);
      assert.equal(await f.token.balanceOf(await f.contract.getAddress()),held);
      assert.equal(await f.token.balanceOf(await f.fee.getAddress()),fees);
    }
    assert.equal(await f.token.balanceOf(f.uplines[0]),0n);
  } finally {await f.close();}
});

test('real token transfers conserve 100% across every level, including 15 equal 1% bonus shares', async () => {
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

test('18-decimal tokens pay the sole parent exactly 10% matrix plus 1% unilevel', async () => {
  const f = await fixture(18);
  try {
    const ancestors = Array(18).fill(ZeroAddress); ancestors[0] = f.uplines[0]; ancestors[3] = f.uplines[0];
    await f.buy(await f.quote(1,{},ancestors));
    const expected = 1_100_000n * f.multiplier;
    assert.equal(await f.token.balanceOf(f.uplines[0]),expected);
    assert.equal(await f.token.balanceOf(await f.fee.getAddress()),10n ** 19n - expected);
    assert.equal(await f.token.balanceOf(await f.contract.getAddress()),0n);
  } finally { await f.close(); }
});

test('separate binary trees pay 10/20/50 and fifteen 1% shares without folding missing depths', async () => {
  for (const count of [0,1,5,14,15]) {
    const f = await fixture();
    try {
      const ancestors = [...f.uplines.slice(0,3),...f.uplines.slice(3).map((address,i) => i < count ? address : ZeroAddress)];
      const receipt = await f.buy(await f.quote(1,{},ancestors));
      const shares = receipt.logs.flatMap(log => { try { const e=f.contract.interface.parseLog(log); return e?.name==='SharePaid'?[e]:[]; } catch { return []; } });
      assert.equal(await f.contract.distributionVersion(),4n);
      assert.deepEqual(shares.slice(0,3).map(e => e.args.amount),[1_000_000n,2_000_000n,5_000_000n]);
      for(let i=0;i<15;i++) {
        assert.equal(shares[i+3].args.amount,100_000n);
        assert.equal(shares[i+3].args.recipient,i<count?ancestors[i+3]:await f.fee.getAddress());
        assert.equal(shares[i+3].args.redirected,i>=count);
      }
      assert.equal(await f.token.balanceOf(await f.fee.getAddress()),500_000n+BigInt(15-count)*100_000n);
    } finally { await f.close(); }
  }
});

test('locked matrix and unilevel positions go to the platform independently', async () => {
  const f=await fixture();
  try {
    const ancestors=Array(18).fill(ZeroAddress); ancestors[0]=f.uplines[0]; ancestors[2]=f.uplines[2]; ancestors[5]=f.uplines[5];
    await f.buy(await f.quote(1,{},ancestors));
    assert.equal(await f.token.balanceOf(f.uplines[0]),1_000_000n);
    assert.equal(await f.token.balanceOf(f.uplines[2]),5_100_000n);
    assert.equal(await f.token.balanceOf(await f.fee.getAddress()),3_900_000n);
  } finally { await f.close(); }
});

test('automatic upgrades spend only approved funds, bind the completed cycle, and cannot replay', async () => {
  const f=await fixture();
  try {
    await f.buy(await f.quote(1));
    const signed=await f.quote(2,{matrixCycle:id('completed-slot-cycle')});
    await assert.rejects(f.contract.connect(f.owner).autoUpgrade(signed.value,signed.uplines,signed.signature));
    assert.equal(await f.contract.upgradedCycles(signed.value.matrixCycle),false);
    await (await f.token.connect(f.buyer).approve(await f.contract.getAddress(),20_000_000n)).wait();
    await assert.rejects(f.contract.connect(f.buyer).purchase(signed.value,signed.uplines,signed.signature));
    await assert.rejects(f.contract.connect(f.owner).autoUpgrade({...signed.value,matrixCycle:id('other-cycle')},signed.uplines,signed.signature));
    await (await f.contract.connect(f.owner).autoUpgrade(signed.value,signed.uplines,signed.signature)).wait();
    assert.equal(await f.contract.levelOf(await f.buyer.getAddress()),2n);
    assert.equal(await f.contract.upgradedCycles(signed.value.matrixCycle),true);
    assert.equal(await f.token.balanceOf(await f.buyer.getAddress()),399970000000n);
    await assert.rejects(f.contract.connect(f.owner).autoUpgrade(signed.value,signed.uplines,signed.signature));
    const replayCycle=await f.quote(3,{matrixCycle:signed.value.matrixCycle});
    await assert.rejects(f.contract.connect(f.owner).autoUpgrade(replayCycle.value,replayCycle.uplines,replayCycle.signature));
  } finally { await f.close(); }
});

test('matrix rebirth and unilevel completion proofs fund successive upgrades through level 15', async () => {
  const f=await fixture();
  try {
    await f.buy(await f.quote(1));
    await (await f.token.connect(f.buyer).approve(await f.contract.getAddress(),327660000000n)).wait();
    for (let level=2;level<=15;level++) {
      const completion=id(level%2 ? `unilevel:${level-1}:member` : `matrix:1:member:${level/2-1}`);
      const signed=await f.quote(level,{matrixCycle:completion});
      await (await f.contract.connect(f.owner).autoUpgrade(signed.value,signed.uplines,signed.signature)).wait();
      assert.equal(await f.contract.levelOf(await f.buyer.getAddress()),BigInt(level));
      assert.equal(await f.contract.upgradedCycles(completion),true);
      await assert.rejects(f.contract.connect(f.owner).autoUpgrade(signed.value,signed.uplines,signed.signature));
    }
    assert.equal(await f.token.balanceOf(await f.buyer.getAddress()),72330000000n);
    assert.equal(await f.token.allowance(await f.buyer.getAddress(),await f.contract.getAddress()),0n);
  } finally { await f.close(); }
});

test('paid rebirths charge their source level, pay the new parents and preserve owned levels through level 15', async () => {
  const f=await fixture(18);
  try {
    await (await f.token.mint(await f.buyer.getAddress(),100000n*10n**18n)).wait();
    for(let level=1;level<=15;level++) await f.buy(await f.quote(level));
    const buyer=await f.buyer.getAddress(), target=f.uplines[4];
    for(const level of [1,2,3,15]) {
      const ancestors=Array(18).fill(ZeroAddress); ancestors[0]=target; ancestors[3]=target;
      const signed=await f.quote(level,{previousLevel:15,matrixCycle:id(`rebirth-level-${level}`)},ancestors);
      const price=await f.contract.priceForLevel(level), before=await f.token.balanceOf(buyer), paid=await f.token.balanceOf(target);
      await (await f.token.connect(f.buyer).approve(await f.contract.getAddress(),price)).wait();
      await assert.rejects(f.contract.connect(f.owner).autoUpgrade(signed.value,signed.uplines,signed.signature));
      await assert.rejects(f.contract.connect(f.buyer).purchase(signed.value,signed.uplines,signed.signature));
      await (await f.contract.connect(f.owner).rebirth(signed.value,signed.uplines,signed.signature)).wait();
      assert.equal(await f.token.balanceOf(buyer),before-price);
      assert.equal(await f.token.balanceOf(target),paid+price*11n/100n);
      assert.equal(await f.contract.levelOf(buyer),15n);
      assert.equal(await f.contract.rebornCycles(signed.value.matrixCycle),true);
      await assert.rejects(f.contract.connect(f.owner).rebirth(signed.value,signed.uplines,signed.signature));
      const replay=await f.quote(level,{previousLevel:15,matrixCycle:signed.value.matrixCycle},ancestors);
      await assert.rejects(f.contract.connect(f.owner).rebirth(replay.value,replay.uplines,replay.signature));
    }
  } finally {await f.close();}
});

test('rebirths retry after insufficient allowance or failed payout without consuming the completion',async()=>{
  const f=await fixture();
  try {
    await f.buy(await f.quote(1));
    const signed=await f.quote(1,{previousLevel:1,matrixCycle:id('retry-rebirth')});
    const pay=()=>f.contract.connect(f.owner).rebirth(signed.value,signed.uplines,signed.signature);
    await assert.rejects(pay());
    assert.equal(await f.contract.rebornCycles(signed.value.matrixCycle),false);
    await (await f.token.connect(f.buyer).approve(await f.contract.getAddress(),10_000_000n)).wait();
    await (await f.token.setBlocked(f.uplines[2])).wait();
    const balance=await f.token.balanceOf(await f.buyer.getAddress());
    await assert.rejects(pay());
    assert.equal(await f.token.balanceOf(await f.buyer.getAddress()),balance);
    assert.equal(await f.contract.rebornCycles(signed.value.matrixCycle),false);
    await (await f.token.setBlocked(ZeroAddress)).wait();
    await (await pay()).wait();
    assert.equal(await f.contract.levelOf(await f.buyer.getAddress()),1n);
    const upgrade=await f.quote(2,{matrixCycle:signed.value.matrixCycle});
    await (await f.token.connect(f.buyer).approve(await f.contract.getAddress(),20_000_000n)).wait();
    await (await f.contract.connect(f.owner).autoUpgrade(upgrade.value,upgrade.uplines,upgrade.signature)).wait();
    assert.equal(await f.contract.levelOf(await f.buyer.getAddress()),2n);
  } finally {await f.close();}
});

test('forged recipients/signatures, wrong buyers, replay, stale fees and expired quotes cannot spend funds', async () => {
  const f = await fixture();
  try {
    await (await f.token.connect(f.buyer).approve(await f.contract.getAddress(), 100000000n)).wait();
    const signed = await f.quote();
    const call = (quote = signed.value, uplines = signed.uplines, signature = signed.signature, caller = f.buyer) => f.contract.connect(caller).purchase(quote, uplines, signature);
    await assert.rejects(call({ ...signed.value, deadline: 1 }));
    await assert.rejects(call(signed.value, Array(18).fill(ZeroAddress)));
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
