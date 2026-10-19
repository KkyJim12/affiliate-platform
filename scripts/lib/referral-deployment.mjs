import fs from 'node:fs';
import { Wallet, ZeroAddress, getAddress, isAddress, keccak256 } from 'ethers';
import { compileContracts } from './compile-contracts.mjs';

const defaults = {
  NUXT_EVM_RPC_URL: 'https://rpc-amoy.polygon.technology/', NUXT_EVM_CHAIN_ID: '80002',
  NUXT_EVM_TOKEN_ADDRESS: '', NUXT_REFERRAL_PAYMENT_MODE: 'contract', NUXT_REFERRAL_CONTRACT_ADDRESS: '',
  NUXT_REFERRAL_MIN_CONFIRMATIONS: '2', REFERRAL_OWNER_ADDRESS: '', REFERRAL_FEE_RECIPIENT_ADDRESS: '', REFERRAL_DEPLOYER_PRIVATE_KEY: '',
};
export function setEnvironmentValue(name, value, overwrite = false) {
  let source = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const matcher = new RegExp(`^${name}=[^\\r\\n]*`, 'm');
  if (matcher.test(source)) {
    if (!overwrite && process.env[name]) return;
    source = source.replace(matcher, `${name}=${value}`);
  } else source += `${source.endsWith('\n') || !source ? '' : newline}${name}=${value}${newline}`;
  fs.writeFileSync('.env', source);
  process.env[name] = value;
}
export function prepareDeployment({ initialize = false } = {}) {
  if (initialize) {
    for (const [name, value] of Object.entries(defaults)) if (!process.env[name]) setEnvironmentValue(name, value);
    if (!process.env.NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY) setEnvironmentValue('NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY', Wallet.createRandom().privateKey);
  }
  const missing = [];
  const address = name => {
    const value = process.env[name];
    if (!value) { missing.push(name); return null; }
    if (!isAddress(value) || getAddress(value) === ZeroAddress) throw new Error(`Invalid ${name}.`);
    return getAddress(value);
  };
  const owner = address('REFERRAL_OWNER_ADDRESS'), feeRecipient = address('REFERRAL_FEE_RECIPIENT_ADDRESS');
  const keyAddress = name => {
    if (!process.env[name]) return null;
    try { return new Wallet(process.env[name]).address; }
    catch { throw new Error(`Invalid private key configuration in ${name}.`); }
  };
  const authority = keyAddress('NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY');
  if (!authority) missing.push('NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY');
  const deployer = keyAddress('REFERRAL_DEPLOYER_PRIVATE_KEY');
  if (!deployer) missing.push('REFERRAL_DEPLOYER_PRIVATE_KEY');
  if (process.env.NUXT_EVM_CHAIN_ID && process.env.NUXT_EVM_CHAIN_ID !== '80002') throw new Error('This deployment workflow only supports Polygon Amoy.');
  const artifacts = compileContracts();
  fs.mkdirSync('.data/contracts', { recursive: true });
  for (const [name, artifact] of Object.entries(artifacts)) fs.writeFileSync(`.data/contracts/${name}.json`, JSON.stringify(artifact, null, 2) + '\n');
  const plan = { chainId: 80002, network: 'Polygon Amoy testnet', mockToken: true, owner, feeRecipient, authority, deployer,
    token: { contract: 'AmoyTestUSDT', symbol: 'tUSDT', decimals: 6, initialOwnerSupply: '1000000', oneTimeFaucetPerWallet: '400000', bytecodeHash: keccak256(artifacts.AmoyTestUSDT.bytecode) },
    distributor: { contract: 'ReferralDistributor', bytecodeHash: keccak256(artifacts.ReferralDistributor.bytecode), prices: '10 * 2^(level - 1)', maxLevel: 15, allocation: '50% + 20% + 10% direct, 1% per upline level across 15 levels; unused trailing bonuses to highest eligible upline, 5% platform' },
    missing, broadcast: false };
  fs.writeFileSync('.data/contracts/deployment-plan.json', JSON.stringify(plan, null, 2) + '\n');
  return { plan, artifacts };
}
