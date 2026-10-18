import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bonusRate, ledgerScale, levelPrice, purchaseShares } from '../shared/compensation.ts';

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
    assert.deepEqual(shares.filter(share => share.kind === 'direct').map(share => share.units), [amount / 2, amount / 5, amount / 10]);
  }
});

test('15 normalized halving shares match exact rational amounts within a single micro-USDT', () => {
  assert.ok(Math.abs(Array.from({ length: 15 }, (_, i) => bonusRate(i + 1)).reduce((a, b) => a + b, 0) - 0.15) < 1e-15);
  for (let level = 1; level <= 15; level++) {
    const shares = purchaseShares(level).filter(share => share.kind === 'bonus');
    for (let index = 0; index < shares.length; index++) {
      const share = shares[index];
      const exact = levelPrice(level) * ledgerScale * bonusRate(index + 1);
      assert.ok(Math.abs(share.units - exact) < 1);
      if (index) {
        assert.ok(shares[index - 1].units > share.units);
        assert.ok(Math.abs(shares[index - 1].units - 2 * share.units) <= 2);
      }
    }
  }
  for (const depth of [0, 16, 1.5, NaN]) assert.throws(() => bonusRate(depth), RangeError);
});
