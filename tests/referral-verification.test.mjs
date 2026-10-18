import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EtherscanVerifier, verificationAddresses } from '../scripts/lib/referral-verification.mjs';

const apiKey = 'test-explorer-key';
const job = { name: 'ReferralDistributor', address: `0x${'12'.repeat(20)}`, contractName: 'contracts/ReferralDistributor.sol:ReferralDistributor',
  compilerVersion: 'v0.8.37+commit.f401782d', constructorArguments: '00'.repeat(128),
  input: { language: 'Solidity', sources: { 'contracts/ReferralDistributor.sol': { content: 'contract ReferralDistributor {}' } },
    settings: { viaIR: true, optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun' } } };
const response = (result, status = '1') => Response.json({ status, message: status === '1' ? 'OK' : 'NOTOK', result });
const unverified = () => response([{ SourceCode: '', ABI: 'Contract source code not verified' }]);
function mockVerifier(responses, extra = {}) {
  const calls = [];
  const verifier = new EtherscanVerifier({ apiKey, interval: 0, attempts: 3, wait: async () => {}, log() {}, ...extra,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      assert.equal(url.origin, 'https://api.etherscan.io');
      assert.equal(url.searchParams.get('chainid'), '80002');
      assert.equal(url.searchParams.get('apikey'), extra.apiKey || apiKey);
      assert.ok(responses.length, 'Unexpected extra explorer request.');
      return responses.shift();
    } });
  return { verifier, calls };
}

test('verification sends Standard JSON, original constructors and compiler settings, then polls the accepted request', async () => {
  const { verifier, calls } = mockVerifier([unverified(), response('request_guid_123'), response('Pending in queue', '0'), response('Pass - Verified')]);
  let savedGuid;
  assert.deepEqual(await verifier.verify(job, { onSubmitted(guid) { savedGuid = guid; } }), { status: 'verified', guid: 'request_guid_123' });
  assert.equal(savedGuid, 'request_guid_123');
  assert.deepEqual(calls.map(call => call.url.searchParams.get('action')), ['getsourcecode', 'verifysourcecode', 'checkverifystatus', 'checkverifystatus']);
  assert.equal(calls[1].options.method, 'POST');
  const body = calls[1].options.body;
  assert.equal(body.get('codeformat'), 'solidity-standard-json-input');
  assert.equal(body.get('contractname'), job.contractName);
  assert.equal(body.get('compilerversion'), job.compilerVersion);
  assert.equal(body.get('constructorArguments'), job.constructorArguments);
  assert.equal(body.get('licenseType'), '3');
  assert.deepEqual(JSON.parse(body.get('sourceCode')), job.input);
  assert.ok(!body.toString().includes(apiKey));
});

test('already verified contracts are skipped, including an explorer race during submission', async () => {
  const first = mockVerifier([response([{ SourceCode: 'pragma solidity ^0.8.24; contract Verified {}' }])]);
  assert.equal((await first.verifier.verify(job)).status, 'already_verified');
  assert.equal(first.calls.length, 1);
  const race = mockVerifier([unverified(), response('Contract source code already verified', '0')]);
  assert.equal((await race.verifier.verify(job)).status, 'already_verified');
});

test('an accepted GUID resumes without submitting source again', async () => {
  const { verifier, calls } = mockVerifier([unverified(), response('Pass - Verified')]);
  assert.equal((await verifier.verify(job, { guid: 'saved_guid' })).status, 'verified');
  assert.deepEqual(calls.map(call => call.url.searchParams.get('action')), ['getsourcecode', 'checkverifystatus']);
  assert.equal(calls[1].url.searchParams.get('guid'), 'saved_guid');
});

test('HTTP and API rate limits retry while a pending verification retains its GUID for another run', async () => {
  const { verifier } = mockVerifier([new Response('', { status: 429 }), unverified(), response('Max rate limit reached', '0'), response('queued_guid'),
    response('Pending in queue', '0'), response('Pending in queue', '0')], { attempts: 2 });
  let guid;
  await assert.rejects(verifier.verify(job, { onSubmitted(value) { guid = value; } }), /still pending.*resume/);
  assert.equal(guid, 'queued_guid');
});

test('explorer verification rejection fails explicitly and credentials are redacted from API/transport errors', async () => {
  const rejection = mockVerifier([unverified(), response('request_guid'), response('Fail - Bytecode does not match', '0')]);
  await assert.rejects(rejection.verifier.verify(job), /Bytecode does not match/);
  const key = 'private api+key';
  const invalid = mockVerifier([response(`Invalid API Key ${key} ${encodeURIComponent(key)}`, '0')], { apiKey: key });
  await assert.rejects(invalid.verifier.verify(job), error => !error.message.includes(key) && !error.message.includes(encodeURIComponent(key)) && error.message.includes('[redacted]'));
  const broken = new EtherscanVerifier({ apiKey: key, fetcher: async url => { throw new Error(String(url)); } });
  await assert.rejects(broken.verify(job), error => error.message.includes('timed out') && !error.message.includes(key) && !error.message.includes(encodeURIComponent(key)));
});

test('missing keys, wrong chain and invalid addresses fail before contacting the explorer', () => {
  assert.throws(() => new EtherscanVerifier({ apiKey: '' }), /ETHERSCAN_API_KEY/);
  assert.throws(() => verificationAddresses({ NUXT_EVM_CHAIN_ID: '137' }), /Amoy/);
  assert.throws(() => verificationAddresses({ NUXT_EVM_TOKEN_ADDRESS: 'not-an-address' }), /NUXT_EVM_TOKEN_ADDRESS/);
  assert.throws(() => verificationAddresses({ NUXT_EVM_TOKEN_ADDRESS: job.address, NUXT_REFERRAL_CONTRACT_ADDRESS: job.address }), /must differ/);
  const result = spawnSync(process.execPath, ['scripts/verify-referral.mjs'], { encoding: 'utf8', env: { ...process.env,
    ETHERSCAN_API_KEY: '', NUXT_EVM_EXPLORER_API_KEY: '', NUXT_EVM_CHAIN_ID: '80002',
    NUXT_EVM_TOKEN_ADDRESS: job.address, NUXT_REFERRAL_CONTRACT_ADDRESS: `0x${'34'.repeat(20)}` } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Set ETHERSCAN_API_KEY/);
});
