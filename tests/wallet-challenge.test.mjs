import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Wallet } from 'ethers';
import { walletAddress, walletChallengeMessage, verifyWalletChallenge, walletLoginOrigin } from '../server/lib/wallet-challenge.ts';
import { legacyPurchaseShares } from '../server/lib/legacy-distribution.ts';
test('wallet challenge binds the signature to domain, account, chain, purpose and one-time nonce', async () => {
  const wallet = Wallet.createRandom();
  const message = walletChallengeMessage('https://unxo.test',wallet.address,'abcd12345678',Date.now(),'login');
  const signature = await wallet.signMessage(message);
  assert.equal(verifyWalletChallenge(message,wallet.address,signature),true);
  assert.equal(verifyWalletChallenge(message,Wallet.createRandom().address,signature),false);
  assert.equal(verifyWalletChallenge(message.replace('unxo.test','other.test'),wallet.address,signature),false);
  assert.equal(verifyWalletChallenge(message.replace('abcd12345678','abcd12345679'),wallet.address,signature),false);
  assert.equal(verifyWalletChallenge(message.replace('80002','137'),wallet.address,signature),false);
  assert.equal(verifyWalletChallenge(message,wallet.address,'0x1234'),false);
  assert.throws(() => walletAddress('0x0000000000000000000000000000000000000000'));
});
test('historical receipt allocations retain the original halving rules and exact totals', () => {
  assert.equal(legacyPurchaseShares(1).find(share => share.kind === 'bonus' && share.depth === 1).units,750023);
  for (let level=1;level<=15;level++) assert.equal(legacyPurchaseShares(level).reduce((sum,share) => sum+share.units,0),10000000*2**(level-1));
});
test('wallet login enforces the configured origin and rejects spoofed production hosts', () => {
  assert.equal(walletLoginOrigin('https://unxo.test','https://unxo.test/path'),'https://unxo.test');
  assert.throws(() => walletLoginOrigin('https://phishing.test','https://unxo.test'),/origin/);
  assert.throws(() => walletLoginOrigin('https://unxo.test',''),/configuration/);
  assert.equal(walletLoginOrigin('http://127.0.0.1:3100',''),'http://127.0.0.1:3100');
});
