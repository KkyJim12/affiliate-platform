import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { network } from 'hardhat';
import { Contract, JsonRpcProvider, Wallet, parseEther, toBeHex } from 'ethers';

test('Amoy deployment command deploys both contracts, preserves env settings and refuses duplicate deployments', { timeout: 120000 }, async () => {
  const root = process.cwd();
  await fs.mkdir(path.join(root, '.data'), { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, '.data/deployment-test-'));
  const server = await network.createServer(undefined, '127.0.0.1', 0);
  let provider;
  try {
    const { port } = await server.listen();
    const url = `http://127.0.0.1:${port}`;
    provider = new JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
    const owner = Wallet.createRandom(), fee = Wallet.createRandom(), authority = Wallet.createRandom(), deployer = Wallet.createRandom();
    await provider.send('hardhat_setBalance', [deployer.address, toBeHex(parseEther('100'))]);
    await provider.send('evm_setIntervalMining', [100]);
    await fs.cp(path.join(root, 'contracts'), path.join(directory, 'contracts'), { recursive: true });
    await fs.mkdir(path.join(directory, 'node_modules/@openzeppelin'), { recursive: true });
    await fs.cp(path.join(root, 'node_modules/@openzeppelin/contracts'), path.join(directory, 'node_modules/@openzeppelin/contracts'), { recursive: true });
    const values = { DATABASE_URL: 'postgresql://unused/untouched', REFERRAL_OWNER_ADDRESS: owner.address,
      REFERRAL_FEE_RECIPIENT_ADDRESS: fee.address, REFERRAL_DEPLOYER_PRIVATE_KEY: deployer.privateKey,
      NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY: authority.privateKey, NUXT_EVM_RPC_URL: url, NUXT_EVM_CHAIN_ID: '80002',
      NUXT_REFERRAL_CONTRACT_ADDRESS: '', NUXT_EVM_TOKEN_ADDRESS: '' };
    await fs.writeFile(path.join(directory, '.env'), Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
    const environment = { ...process.env };
    for (const key of Object.keys(values)) delete environment[key];
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--env-file=.env', path.join(root, 'scripts/deploy-referral.mjs'), '--broadcast'], { cwd: directory, env: environment });
      let output = '';
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
      child.once('error', reject);
      child.once('exit', code => resolve({ code, output }));
    });
    const result = await run();
    assert.equal(result.code, 0, 'Local deployment command must succeed.');
    for (const key of [deployer.privateKey, authority.privateKey]) assert.ok(!result.output.includes(key), 'Deployment output must not contain private keys.');
    const progress = JSON.parse(await fs.readFile(path.join(directory, '.data/contracts/deployment-progress.json'), 'utf8'));
    const tokenAddress = progress.transactions.AmoyTestUSDT.address;
    const distributorAddress = progress.transactions.ReferralDistributor.address;
    const token = new Contract(tokenAddress, ['function owner() view returns (address)', 'function balanceOf(address) view returns (uint256)'], provider);
    const distributor = new Contract(distributorAddress, ['function owner() view returns (address)', 'function feeRecipient() view returns (address)',
      'function quoteSigner() view returns (address)', 'function paymentToken() view returns (address)'], provider);
    assert.equal(await token.owner(), owner.address);
    assert.equal(await token.balanceOf(owner.address), 1_000_000_000_000n);
    assert.equal(await distributor.owner(), owner.address);
    assert.equal(await distributor.feeRecipient(), fee.address);
    assert.equal(await distributor.quoteSigner(), authority.address);
    assert.equal(await distributor.paymentToken(), tokenAddress);
    for (const entry of Object.values(progress.transactions)) {
      const receipt = await provider.getTransactionReceipt(entry.hash);
      assert.ok(await receipt.confirmations() >= 2, 'Deployment requires two confirmations.');
    }
    const saved = await fs.readFile(path.join(directory, '.env'), 'utf8');
    assert.ok(saved.includes(`NUXT_REFERRAL_CONTRACT_ADDRESS=${distributorAddress}`));
    assert.ok(saved.includes(`NUXT_EVM_TOKEN_ADDRESS=${tokenAddress}`));
    assert.ok(saved.includes('DATABASE_URL=postgresql://unused/untouched'));
    assert.equal((await run()).code, 1, 'A configured distributor must prevent duplicate deployment.');
    assert.equal(await provider.getTransactionCount(deployer.address), 2);
  } finally {
    provider?.destroy();
    await server.close();
    if (path.dirname(directory) !== path.join(root, '.data') || !path.basename(directory).startsWith('deployment-test-')) throw new Error('Unexpected test directory.');
    await fs.rm(directory, { recursive: true, force: true });
  }
});
