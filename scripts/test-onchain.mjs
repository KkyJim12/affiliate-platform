import { spawn } from 'node:child_process';
import { network } from 'hardhat';
import { ContractFactory, JsonRpcProvider, Wallet, parseEther, toBeHex } from 'ethers';
import { compileContracts } from './lib/compile-contracts.mjs';
import { POLYGON_USDT } from './lib/mainnet-deployment.mjs';

// All transactions stay on a fresh localhost simulation of the selected chain.
const mainnet = process.argv.includes('--mainnet');
const server = await network.createServer(mainnet?'polygon':undefined, '127.0.0.1', 0);
const external = mainnet || process.argv.includes('--external');
const passwordLogin = process.env.NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED ?? (external ? 'false' : 'true');
let provider;
let testExitCode = 1;
try {
  const { port } = await server.listen();
  const url = `http://127.0.0.1:${port}`;
  provider = new JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const deployer = await provider.getSigner(0), owner = Wallet.createRandom(), authority = Wallet.createRandom();
  const artifacts = compileContracts({ includeTests: true });
  let token = mainnet ? await new ContractFactory(artifacts.PolygonUsdtFixture.abi,artifacts.PolygonUsdtFixture.bytecode,deployer).deploy()
    : await new ContractFactory(artifacts.TestPaymentToken.abi, artifacts.TestPaymentToken.bytecode, deployer).deploy(6);
  await token.waitForDeployment();
  if(mainnet) {
    await provider.send('hardhat_setCode',[POLYGON_USDT,await provider.getCode(await token.getAddress())]);
    const { Contract }=await import('ethers');
    token=new Contract(POLYGON_USDT,artifacts.PolygonUsdtFixture.abi,deployer);
  }
  const fee = Wallet.createRandom().address;
  const contract = await new ContractFactory(artifacts.ReferralDistributor.abi, artifacts.ReferralDistributor.bytecode, deployer)
    .deploy(await token.getAddress(), owner.address, fee, authority.address);
  await contract.waitForDeployment();
  await provider.send('hardhat_setBalance', [owner.address, toBeHex(parseEther('100'))]);
  await provider.send('hardhat_setBalance', [authority.address, toBeHex(parseEther('100'))]);
  const specs = mainnet ? ['mainnet-app.spec.ts'] : external ? ['connected-wallet.spec.ts','account-settings.spec.ts','platform-workspace.spec.ts'] : ['onchain-referral.spec.ts','onchain-wallet.spec.ts'];
  const child = spawn(process.execPath, ['scripts/test-postgres.mjs', 'ui', ...specs, ...process.argv.slice(2).filter(arg => !['--external','--mainnet'].includes(arg))], {
    stdio: 'inherit', env: { ...process.env, NUXT_REFERRAL_PAYMENT_MODE: 'contract', NUXT_EVM_RPC_URL: url, NUXT_EVM_CHAIN_ID: mainnet?'137':'80002',NUXT_PUBLIC_CHAIN_ID:mainnet?'137':'80002',
      NUXT_EVM_TOKEN_ADDRESS: await token.getAddress(), NUXT_EVM_MIN_CONFIRMATIONS: '1', NUXT_REFERRAL_CONTRACT_ADDRESS: await contract.getAddress(),
      NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY: authority.privateKey, NUXT_REFERRAL_MIN_CONFIRMATIONS: '1',
      REFERRAL_TEST_OWNER_KEY: owner.privateKey, REFERRAL_TEST_ORIGINAL_FEE: fee, NUXT_PUBLIC_WALLET_MODE: external ? 'external' : 'embedded',
      NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED: passwordLogin },
  });
  testExitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally { provider?.destroy(); await server.close(); }
process.exitCode = testExitCode;
