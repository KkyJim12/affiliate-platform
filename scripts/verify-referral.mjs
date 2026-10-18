import fs from 'node:fs';
import { FetchRequest, JsonRpcProvider } from 'ethers';
import { EtherscanVerifier, VerificationError, prepareVerification, safeVerificationMessage, verificationAddresses } from './lib/referral-verification.mjs';

const dryRun = process.argv.includes('--dry-run');
const apiKey = process.env.ETHERSCAN_API_KEY || process.env.NUXT_EVM_EXPLORER_API_KEY || '';
let provider;
try {
  if (process.argv.slice(2).some(arg => arg !== '--dry-run')) throw new VerificationError('Usage: npm run contracts:verify -- [--dry-run]');
  verificationAddresses();
  const verifier = dryRun ? null : new EtherscanVerifier({ apiKey });
  console.log('Preparing Polygon Amoy (80002) source verification...');
  const jobs = prepareVerification();
  for (const job of jobs) console.log(`${job.name}: ${job.address}, ${job.compilerVersion}; constructors from ${job.constructorSource}.`);
  console.log('Public verification inputs saved to .data/contracts/verification/.');
  if (dryRun) {
    console.log('Dry run complete. No explorer requests or blockchain transactions were sent.');
  } else {
    const rpcUrl = process.env.NUXT_EVM_RPC_URL || 'https://rpc-amoy.polygon.technology/';
    try {
      if (!/^https?:$/.test(new URL(rpcUrl).protocol)) throw new Error();
      const request = new FetchRequest(rpcUrl); request.timeout = 10000;
      provider = new JsonRpcProvider(request, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
      if ((await provider.getNetwork()).chainId !== 80002n) throw new VerificationError('RPC must point to Polygon Amoy (80002).');
      for (const job of jobs) if (await provider.getCode(job.address) === '0x') throw new VerificationError(`${job.name} is not deployed at the configured Amoy address.`);
    } catch (error) {
      if (error instanceof VerificationError) throw error;
      throw new VerificationError('Could not read the Amoy deployment. Check NUXT_EVM_RPC_URL and retry.');
    }
    const stateFile = '.data/contracts/verification/status.json';
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
    let failed = false;
    for (const job of jobs) {
      try {
        const previous = state[job.fingerprint];
        const result = await verifier.verify(job, { guid: previous?.status === 'pending' ? previous.guid : undefined,
          onSubmitted(guid) {
            state[job.fingerprint] = { address: job.address, name: job.name, status: 'pending', guid }; save();
            console.log(`${job.name}: source submitted; waiting for verification.`);
          } });
        state[job.fingerprint] = { address: job.address, name: job.name, ...result }; save();
        console.log(`${job.name}: ${result.status === 'already_verified' ? 'already verified' : 'verified successfully'}. https://amoy.polygonscan.com/address/${job.address}#code`);
      } catch (error) {
        if (error instanceof VerificationError && /still pending|request failed|HTTP|Unexpected Etherscan response/.test(error.message)) {
          // Preserve an accepted request through provider/HTTP timeouts.
        } else if (state[job.fingerprint]) { state[job.fingerprint].status = 'failed'; save(); }
        console.error(`${job.name}: ${error instanceof VerificationError ? safeVerificationMessage(error.message, apiKey) : 'Verification could not be completed. Check the saved inputs and retry.'}`);
        failed = true;
      }
    }
    if (failed) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof VerificationError ? safeVerificationMessage(error.message, apiKey)
    : 'Verification preparation failed. Check the saved deployment artifacts, source files and .env configuration.');
  process.exitCode = 1;
} finally { provider?.destroy(); }
