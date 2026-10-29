import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import solc from 'solc';
import { AbiCoder, Transaction, Wallet, ZeroAddress, getAddress, getCreateAddress, keccak256, toUtf8Bytes } from 'ethers';

export class VerificationError extends Error {}
const contractNames = ['AmoyTestUSDT', 'ReferralDistributor'];
const abi = AbiCoder.defaultAbiCoder();

function address(value, field) {
  try { if (getAddress(value) !== ZeroAddress) return getAddress(value); } catch {}
  throw new VerificationError(`Set a valid, nonzero ${field} in .env.`);
}

export function verificationAddresses(env = process.env) {
  if (env.NUXT_EVM_CHAIN_ID && env.NUXT_EVM_CHAIN_ID !== '80002') throw new VerificationError('Contract verification requires Polygon Amoy (80002).');
  const token = address(env.NUXT_EVM_TOKEN_ADDRESS, 'NUXT_EVM_TOKEN_ADDRESS');
  const distributor = address(env.NUXT_REFERRAL_CONTRACT_ADDRESS, 'NUXT_REFERRAL_CONTRACT_ADDRESS');
  if (token === distributor) throw new VerificationError('Token and distributor addresses must differ.');
  return { AmoyTestUSDT: token, ReferralDistributor: distributor };
}

// Reconstruct the exact compiler input from the saved build's source hashes.
// No .env contents, wallet keys or signed transactions enter these public files.
export function prepareVerification(env = process.env, root = process.cwd()) {
  const addresses = verificationAddresses(env);
  const directory = path.join(root, '.data/contracts');
  const artifacts = {};
  for (const name of contractNames) {
    const filename = path.join(directory, `${name}.json`);
    if (!fs.existsSync(filename)) throw new VerificationError(`Missing ${name} build. Run npm run contracts:compile first.`);
    artifacts[name] = JSON.parse(fs.readFileSync(filename, 'utf8'));
  }
  const sources = {};
  for (const artifact of Object.values(artifacts)) {
    if (artifact.compilerVersion !== solc.version()) throw new VerificationError('Installed solc differs from the deployment compiler. Restore the original package-lock.json and dependencies.');
    for (const [name, expected] of Object.entries(artifact.metadata.sources)) {
      const base = path.resolve(root, name.startsWith('@openzeppelin/') ? 'node_modules' : '.');
      const filename = path.resolve(base, name);
      if (!filename.startsWith(base + path.sep)) throw new VerificationError('Invalid source path in the deployment build.');
      const content = fs.readFileSync(filename, 'utf8');
      if (keccak256(toUtf8Bytes(content)) !== expected.keccak256) throw new VerificationError(`Source changed since compilation: ${name}. Restore the deployed source before verifying.`);
      sources[name] = { content };
    }
  }
  const progressFile = path.join(directory, 'deployment-progress.json');
  const progress = fs.existsSync(progressFile) ? JSON.parse(fs.readFileSync(progressFile, 'utf8')) : null;
  const replacementFile = path.join(directory,'latest-replacement.json');
  const replacement = fs.existsSync(replacementFile) ? JSON.parse(fs.readFileSync(replacementFile,'utf8')) : null;
  const jobs = contractNames.map(name => {
    const artifact = artifacts[name];
    const { compilationTarget, ...settings } = artifact.metadata.settings;
    settings.outputSelection = { '*': { '*': ['abi', 'evm.bytecode.object'] } };
    const input = { language: 'Solidity', sources, settings };
    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    if (output.errors?.some(item => item.severity === 'error')) throw new VerificationError(`Cannot compile ${name} verification input.`);
    const filename = Object.keys(compilationTarget)[0];
    const bytecode = `0x${output.contracts[filename][name].evm.bytecode.object}`;
    if (bytecode !== artifact.bytecode) throw new VerificationError(`${name} verification bytecode differs from the saved build.`);
    const replaced = replacement?.transactions?.[name];
    const saved = replaced?.address && getAddress(replaced.address) === addresses[name] ? replaced : progress?.transactions?.[name];
    const types = name === 'AmoyTestUSDT' ? ['address'] : ['address', 'address', 'address', 'address'];
    let constructorArguments, constructorSource;
    if (saved?.raw && getAddress(saved.address) === addresses[name]) {
      const tx = Transaction.from(saved.raw);
      if (tx.to !== null || tx.chainId !== 80002n || tx.hash !== saved.hash
        || getCreateAddress({ from: tx.from, nonce: tx.nonce }) !== addresses[name] || !tx.data.startsWith(bytecode))
        throw new VerificationError(`${name} saved deployment does not match the configured address/build.`);
      constructorArguments = tx.data.slice(bytecode.length);
      if (abi.encode(types, abi.decode(types, `0x${constructorArguments}`)).slice(2) !== constructorArguments)
        throw new VerificationError(`Invalid ${name} deployment constructor arguments.`);
      constructorSource = 'saved deployment';
    } else {
      const owner = address(env.REFERRAL_OWNER_ADDRESS, 'REFERRAL_OWNER_ADDRESS');
      let values = [owner];
      if (name === 'ReferralDistributor') {
        let signer = env.REFERRAL_QUOTE_SIGNER_ADDRESS;
        if (!signer && env.NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY) {
          try { signer = new Wallet(env.NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY).address; }
          catch { throw new VerificationError('Invalid NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY configuration.'); }
        }
        values = [addresses.AmoyTestUSDT, owner, address(env.REFERRAL_FEE_RECIPIENT_ADDRESS, 'REFERRAL_FEE_RECIPIENT_ADDRESS'),
          address(signer, 'REFERRAL_QUOTE_SIGNER_ADDRESS')];
      }
      constructorArguments = abi.encode(types, values).slice(2);
      constructorSource = '.env (original deployment values)';
    }
    const compilerVersion = `v${artifact.metadata.compiler.version}`;
    const contractName = `${filename}:${name}`;
    const fingerprint = keccak256(toUtf8Bytes(JSON.stringify([addresses[name], compilerVersion, input, constructorArguments])));
    return { name, address: addresses[name], input, compilerVersion, contractName, constructorArguments, constructorSource, fingerprint };
  });
  const target = path.join(directory, 'verification');
  fs.mkdirSync(target, { recursive: true });
  for (const job of jobs) {
    fs.writeFileSync(path.join(target, `${job.name}.standard-input.json`), JSON.stringify(job.input, null, 2) + '\n');
    fs.writeFileSync(path.join(target, `${job.name}.constructor-args.txt`), job.constructorArguments + '\n');
    const { input, ...publicSettings } = job;
    fs.writeFileSync(path.join(target, `${job.name}.settings.json`), JSON.stringify(publicSettings, null, 2) + '\n');
  }
  return jobs;
}

export function safeVerificationMessage(value, apiKey = '') {
  let text = String(value);
  if (apiKey) text = text.split(apiKey).join('[redacted]').split(encodeURIComponent(apiKey)).join('[redacted]');
  return text.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 500);
}

const alreadyVerified = result => /already\s*(?:been\s*)?verified/i.test(String(result));
const retryable = result => /pending|queue|rate limit|temporarily unavailable|try again|not yet indexed|unable to locate contractcode/i.test(String(result));

export class EtherscanVerifier {
  constructor({ apiKey, chainId = 80002, fetcher = fetch, wait = delay, attempts = 24, interval = 5000, log = console.log }) {
    if (!apiKey?.trim()) throw new VerificationError('Set ETHERSCAN_API_KEY in .env (or NUXT_EVM_EXPLORER_API_KEY).');
    if (![137,80002].includes(Number(chainId))) throw new VerificationError('Unsupported verification network.');
    Object.assign(this, { apiKey: apiKey.trim(), chainId:Number(chainId), fetcher, wait, attempts, interval, log });
  }

  async request(action, parameters = {}, post = false) {
    const url = new URL('https://api.etherscan.io/v2/api');
    url.search = new URLSearchParams({ chainid: String(this.chainId), module: 'contract', action, apikey: this.apiKey,
      ...(!post ? parameters : {}) }).toString();
    let response, data;
    try {
      response = await this.fetcher(url, { method: post ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
        ...(post ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(parameters) } : {}) });
      if (response.ok) data = await response.json();
    } catch { throw new VerificationError('Etherscan request failed or timed out. Rerun the verification command to resume.'); }
    if (response.status === 429 || response.status >= 500) return { status: '0', result: 'Etherscan temporarily unavailable; try again.' };
    if (!response.ok) throw new VerificationError(`Etherscan returned HTTP ${response.status}. Check API access and retry.`);
    if (!data || !['0', '1'].includes(data.status)) throw new VerificationError('Unexpected Etherscan response. Check API access and retry.');
    return data;
  }

  async verify(job, { guid, onSubmitted = () => {} } = {}) {
    // Check the explorer rather than trusting a local success flag.
    for (let attempt = 0; ; attempt++) {
      const existing = await this.request('getsourcecode', { address: job.address });
      if (existing.status === '1' && Array.isArray(existing.result)) {
        if (existing.result[0]?.SourceCode?.trim()) return { status: 'already_verified' };
        break;
      }
      if (alreadyVerified(existing.result)) return { status: 'already_verified' };
      if (!retryable(existing.result) || attempt >= this.attempts - 1) this.fail(existing.result);
      await this.wait(this.interval);
    }
    if (!guid) {
      for (let attempt = 0; ; attempt++) {
        const submitted = await this.request('verifysourcecode', { contractaddress: job.address, codeformat: 'solidity-standard-json-input',
          sourceCode: JSON.stringify(job.input), contractname: job.contractName, compilerversion: job.compilerVersion,
          constructorArguments: job.constructorArguments, licenseType: '3' }, true);
        if (alreadyVerified(submitted.result)) return { status: 'already_verified' };
        if (submitted.status === '1' && /^[a-zA-Z0-9_-]{1,200}$/.test(submitted.result)) {
          guid = submitted.result; await onSubmitted(guid); break;
        }
        if (!retryable(submitted.result) || attempt >= this.attempts - 1) this.fail(submitted.result);
        await this.wait(this.interval);
      }
    }
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      await this.wait(this.interval);
      const result = await this.request('checkverifystatus', { guid });
      if (alreadyVerified(result.result) || result.status === '1' && /pass\s*-\s*verified/i.test(result.result)) return { status: 'verified', guid };
      if (!retryable(result.result)) this.fail(result.result);
      this.log(`${job.name}: verification pending (${attempt + 1}/${this.attempts}).`);
    }
    throw new VerificationError(`${job.name} is still pending at Etherscan. Rerun the command to resume the saved request.`);
  }

  fail(result) { throw new VerificationError(`Etherscan: ${safeVerificationMessage(result, this.apiKey)}`); }
}
