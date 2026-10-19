import { spawn } from 'node:child_process';
import { network } from 'hardhat';
import { ContractFactory, JsonRpcProvider, Wallet, parseEther, toBeHex } from 'ethers';
import { compileContracts } from './lib/compile-contracts.mjs';

// All transactions in this runner stay on a fresh localhost Amoy simulation.
const server = await network.createServer(undefined, '127.0.0.1', 0);
const external = process.argv.includes('--external');
let provider;
let testExitCode = 1;
try {
  const { port } = await server.listen();
  const url = `http://127.0.0.1:${port}`;
  provider = new JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const deployer = await provider.getSigner(0), owner = Wallet.createRandom(), authority = Wallet.createRandom();
  const artifacts = compileContracts({ includeTests: true });
  const token = await new ContractFactory(artifacts.TestPaymentToken.abi, artifacts.TestPaymentToken.bytecode, deployer).deploy(6);
  await token.waitForDeployment();
  const fee = Wallet.createRandom().address;
  const contract = await new ContractFactory(artifacts.ReferralDistributor.abi, artifacts.ReferralDistributor.bytecode, deployer)
    .deploy(await token.getAddress(), owner.address, fee, authority.address);
  await contract.waitForDeployment();
  await provider.send('hardhat_setBalance', [owner.address, toBeHex(parseEther('100'))]);
  const specs = external ? ['connected-wallet.spec.ts'] : ['onchain-referral.spec.ts','onchain-wallet.spec.ts'];
  const child = spawn(process.execPath, ['scripts/test-postgres.mjs', 'ui', ...specs, ...process.argv.slice(2).filter(arg => arg !== '--external')], {
    stdio: 'inherit', env: { ...process.env, NUXT_REFERRAL_PAYMENT_MODE: 'contract', NUXT_EVM_RPC_URL: url, NUXT_EVM_CHAIN_ID: '80002',
      NUXT_EVM_TOKEN_ADDRESS: await token.getAddress(), NUXT_EVM_MIN_CONFIRMATIONS: '1', NUXT_REFERRAL_CONTRACT_ADDRESS: await contract.getAddress(),
      NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY: authority.privateKey, NUXT_REFERRAL_MIN_CONFIRMATIONS: '1',
      REFERRAL_TEST_OWNER_KEY: owner.privateKey, REFERRAL_TEST_ORIGINAL_FEE: fee, NUXT_PUBLIC_WALLET_MODE: external ? 'external' : 'embedded' },
  });
  testExitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally { provider?.destroy(); await server.close(); }
process.exitCode = testExitCode;
