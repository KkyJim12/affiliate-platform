import assert from "node:assert/strict";
import test from "node:test";
import { computeAddress } from "ethers";
import { decryptEvmPrivateKey, generateEncryptedEvmWallet, publicEvmWallet } from "../server/lib/evm-wallet.ts";

test("random Amoy wallets store a password-encrypted V3 keystore and only expose public metadata", async () => {
  const password = "A unique wallet testing password 42!";
  const first = await generateEncryptedEvmWallet(password);
  const second = await generateEncryptedEvmWallet(password);
  assert.notEqual(first.address, second.address);
  assert.equal(first.chain_id, 80002);
  assert.equal(computeAddress(first.public_key), first.address);
  const keystore = JSON.parse(first.encrypted_keystore);
  assert.equal(keystore.version, 3);
  assert.equal(keystore.Crypto.cipher, "aes-128-ctr");
  assert.equal(keystore.Crypto.kdf, "scrypt");
  assert.ok(keystore.Crypto.kdfparams.n >= 131072);
  assert.match(keystore.Crypto.ciphertext, /^[0-9a-f]{64}$/);
  const privateKey = await decryptEvmPrivateKey(first, password);
  assert.equal(computeAddress(privateKey), first.address);
  assert.ok(!JSON.stringify(first).includes(privateKey));
  assert.ok(!("mnemonic" in keystore));
  assert.ok(!("x-ethers" in keystore));
  const details = publicEvmWallet(first);
  assert.equal(details.network, "Polygon Amoy");
  assert.equal(details.testnet, true);
  assert.equal(details.chainId, 80002);
  assert.match(details.explorerUrl, /^https:\/\/amoy\.polygonscan\.com\/address\/0x/);
  assert.ok(!("encrypted_keystore" in details));
  assert.ok(!("privateKey" in details));
  await assert.rejects(decryptEvmPrivateKey(first, "Different invalid password!"));
  await assert.rejects(decryptEvmPrivateKey({ ...first, address: second.address }, password), /identity/);
  await assert.rejects(decryptEvmPrivateKey({ ...first, chain_id: 137 }, password), /network/);
  assert.throws(() => publicEvmWallet({ ...first, chain_id: 137 }), /network/);
});

test("wallet generation rejects invalid encryption passwords", async () => {
  await assert.rejects(generateEncryptedEvmWallet("short"));
  await assert.rejects(generateEncryptedEvmWallet("a".repeat(129)));
});
