import fs from 'node:fs';
import { Contract, ContractFactory, FetchRequest, JsonRpcProvider, Wallet, getAddress, getCreateAddress, keccak256 } from 'ethers';
import { prepareDeployment, setEnvironmentValue } from './lib/referral-deployment.mjs';

const broadcast = process.argv.includes('--broadcast');
const replacing = process.argv.includes('--replace-distributor');
let provider;
try {
  const { plan, artifacts } = prepareDeployment();
  if (replacing) {
    plan.replaces = process.env.NUXT_REFERRAL_CONTRACT_ADDRESS || null;
    plan.existingToken = process.env.NUXT_EVM_TOKEN_ADDRESS || null;
    if (!plan.replaces || !plan.existingToken) throw new Error('Replacement requires the existing token and distributor addresses in .env.');
    plan.token = { address: getAddress(plan.existingToken), reused: true };
    fs.writeFileSync('.data/contracts/replacement-plan.json', JSON.stringify(plan,null,2) + '\n');
  }
  console.log(JSON.stringify(plan, null, 2));
  if (!broadcast) {
    console.log('Deployment plan only. No transactions were broadcast.');
  } else {
    if (plan.missing.length) throw new Error(`Set the required .env fields first: ${plan.missing.join(', ')}`);
    if (process.env.NUXT_REFERRAL_CONTRACT_ADDRESS && !replacing) throw new Error('A referral contract is already configured. Refusing to deploy a duplicate.');
    if (replacing) {
      const flag = process.argv.indexOf('--previous-contract');
      if (flag === -1 || getAddress(process.argv[flag + 1] || '') !== getAddress(plan.replaces))
        throw new Error('Confirm the exact current distributor with --previous-contract <address> to replace it.');
    }
    const request = new FetchRequest(process.env.NUXT_EVM_RPC_URL); request.timeout = 10000;
    provider = new JsonRpcProvider(request, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
    if ((await provider.getNetwork()).chainId !== 80002n) throw new Error('RPC must point to Polygon Amoy (80002).');
    const wallet = new Wallet(process.env.REFERRAL_DEPLOYER_PRIVATE_KEY, provider);
    const filename = replacing ? `.data/contracts/replacement-${getAddress(plan.replaces)}.json` : '.data/contracts/deployment-progress.json';
    const progress = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : { owner: plan.owner, feeRecipient: plan.feeRecipient, authority: plan.authority,
      ...(replacing ? { previousContract: getAddress(plan.replaces), tokenAddress: getAddress(plan.existingToken) } : {}), transactions: {} };
    if (progress.owner !== plan.owner || progress.feeRecipient !== plan.feeRecipient || progress.authority !== plan.authority)
      throw new Error('An earlier deployment has different constructor addresses. Resolve it before changing the deployment plan.');
    if (replacing && progress.tokenAddress !== getAddress(plan.existingToken)) throw new Error('Replacement token differs from the saved plan.');
    if (replacing) {
      const old = new Contract(plan.replaces,['function paymentToken() view returns(address)'],provider);
      if (getAddress(await old.paymentToken()) !== getAddress(plan.existingToken)) throw new Error('Existing distributor/token configuration does not match.');
      if (await provider.getCode(plan.existingToken) === '0x') throw new Error('Existing token is not deployed.');
    }
    const save = () => fs.writeFileSync(filename, JSON.stringify(progress, null, 2) + '\n');
    async function deploy(name, args) {
      const artifact = artifacts[name];
      const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
      const request = await factory.getDeployTransaction(...args);
      let pending = progress.transactions[name];
      if (pending && pending.dataHash !== keccak256(request.data)) throw new Error(`The pending ${name} deployment does not match this build.`);
      if (!pending) {
        const tx = await wallet.populateTransaction({ ...request, gasLimit: await provider.estimateGas({ ...request, from: wallet.address }) * 120n / 100n });
        const raw = await wallet.signTransaction(tx);
        pending = { raw, hash: keccak256(raw), dataHash: keccak256(request.data), address: getCreateAddress({ from: wallet.address, nonce: tx.nonce }) };
        progress.transactions[name] = pending; save();
      }
      let receipt = await provider.getTransactionReceipt(pending.hash);
      if (!receipt) {
        try { await provider.broadcastTransaction(pending.raw); }
        catch { if (!await provider.getTransaction(pending.hash)) throw new Error(`Unable to confirm broadcast of ${name}. Signed bytes are saved; retry this command to resume.`); }
        console.log(`${name} pending: ${pending.hash}`);
      }
      if (!receipt || await receipt.confirmations() < 2) receipt = await provider.waitForTransaction(pending.hash, 2, 120000);
      if (!receipt || receipt.status !== 1) throw new Error(`${name} deployment is pending or reverted. See ${filename}.`);
      if (await provider.getCode(pending.address) === '0x') throw new Error(`${name} deployed bytecode is unavailable.`);
      console.log(`${name} deployed: ${pending.address}`);
      return pending.address;
    }
    const tokenAddress = replacing ? getAddress(plan.existingToken) : await deploy('AmoyTestUSDT', [plan.owner]);
    const contractAddress = await deploy('ReferralDistributor', [tokenAddress, plan.owner, plan.feeRecipient, plan.authority]);
    setEnvironmentValue('NUXT_EVM_TOKEN_ADDRESS', tokenAddress, true);
    setEnvironmentValue('NUXT_REFERRAL_CONTRACT_ADDRESS', contractAddress, true);
    setEnvironmentValue('NUXT_REFERRAL_PAYMENT_MODE', 'contract', true);
    if (replacing) fs.writeFileSync('.data/contracts/latest-replacement.json',JSON.stringify(progress,null,2) + '\n');
    console.log('Deployment confirmed. Public token/contract addresses were saved to .env. Restart the application.');
  }
} catch (error) {
  // Provider error messages can include RPC credentials or raw requests.
  console.error(error?.code ? 'Deployment could not be completed. Check the saved progress and RPC/gas configuration.' : error.message);
  process.exitCode = 1;
} finally { provider?.destroy(); }
