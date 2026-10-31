import assert from 'node:assert/strict';
import { test } from 'node:test';
import { referralExemptMemberIds } from '../shared/referral-purchase-policy.ts';

test('only member ID 1 is exempt by default; explicit configuration can replace or disable it',()=>{
  assert.deepEqual(referralExemptMemberIds(),['1']);
  assert.deepEqual(referralExemptMemberIds(1),['1']);
  assert.deepEqual(referralExemptMemberIds(' 7, 18,7 '),['7','18']);
  assert.deepEqual(referralExemptMemberIds(''),[]);
  assert.deepEqual(referralExemptMemberIds('  '),[]);
});

test('referral exemption configuration rejects wildcards, noncanonical IDs and wallet addresses',()=>{
  for(const value of ['*','0','01','-1','1.5','1,,2','1,','1 2','9007199254740992','0x1234','admin','1,*',null,true,[],0,1.5])
    assert.throws(()=>referralExemptMemberIds(value),/Invalid referral purchase exemption/);
});
