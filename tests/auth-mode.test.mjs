import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passwordLoginEnabled } from '../shared/auth-mode.ts';

test('password login requires an explicit true setting; environment string false stays disabled', () => {
  for (const value of [undefined, null, false, 'false', '', '0', 0, 1, 'TRUE', ' true ', {}, [], ['true']])
    assert.equal(passwordLoginEnabled(value), false, `Unexpected password login for ${JSON.stringify(value)}`);
  assert.equal(passwordLoginEnabled(true), true);
  assert.equal(passwordLoginEnabled('true'), true);
});
