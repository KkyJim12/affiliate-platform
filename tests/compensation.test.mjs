import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bonusRate, ledgerScale, levelPrice, purchaseShares, shareRecipientDepth } from '../shared/compensation.ts';

test('all 15 prices double, bounded from $10 through $163,840', () => {
  assert.deepEqual(Array.from({ length: 15 }, (_, i) => levelPrice(i + 1)),
    [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480, 40960, 81920, 163840]);
  for (const value of [0, 16, -1, 1.5, NaN, Infinity]) assert.throws(() => levelPrice(value), RangeError);
});

test('every price conserves 100% with exact 80/15/5 pools and positive integer micro-USDT', () => {
  for (let level = 1; level <= 15; level++) {
    const shares = purchaseShares(level), amount = levelPrice(level) * ledgerScale;
    assert.equal(shares.length, 19);
    assert.ok(shares.every(share => Number.isSafeInteger(share.units) && share.units > 0));
    assert.equal(shares.reduce((sum, share) => sum + share.units, 0), amount);
    for (const [kind, percent] of [['direct', 80], ['bonus', 15], ['platform', 5]])
      assert.equal(shares.filter(share => share.kind === kind).reduce((sum, share) => sum + share.units, 0), amount * percent / 100);
    assert.deepEqual(shares.filter(share => share.kind === 'direct').map(share => share.units), [amount / 10, amount / 5, amount / 2]);
  }
});

test('every bonus share is exactly 1%, at every purchase level', () => {
  assert.ok(Math.abs(Array.from({ length: 15 }, (_, i) => bonusRate(i + 1)).reduce((a, b) => a + b, 0) - 0.15) < 1e-15);
  for (let level = 1; level <= 15; level++) {
    const shares = purchaseShares(level).filter(share => share.kind === 'bonus');
    for (let index = 0; index < shares.length; index++) {
      const share = shares[index];
      const exact = levelPrice(level) * ledgerScale * bonusRate(index + 1);
      assert.equal(share.units, exact);
      assert.equal(bonusRate(index + 1), 0.01);
    }
  }
  for (const depth of [0, 16, 1.5, NaN]) assert.throws(() => bonusRate(depth), RangeError);
});

test('missing and locked shares go to the platform without changing their depth', () => {
  for(let count=0;count<=15;count++) {
    const eligible=Array.from({length:15},(_,i)=>i<count);
    for(const share of purchaseShares(1)) assert.equal(shareRecipientDepth(share,eligible),share.depth && share.depth<=count?share.depth:0);
  }
  assert.equal(shareRecipientDepth({kind:'bonus',depth:2},[true,false,true]),0);
  assert.equal(shareRecipientDepth({kind:'bonus',depth:15},[true,false,true]),0);
});
