import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';

export function compileContracts({ includeTests = false, distributorOnly = false } = {}) {
  const names = ['contracts/ReferralDistributor.sol', ...(distributorOnly ? [] : ['contracts/AmoyTestUSDT.sol']), ...(includeTests ? ['contracts/test/TestPaymentToken.sol','contracts/test/PolygonUsdtFixture.sol'] : [])];
  const input = { language: 'Solidity', sources: Object.fromEntries(names.map(name => [name, { content: fs.readFileSync(name, 'utf8') }])),
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun',
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata'] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import(name) {
    const resolved = path.resolve('node_modules', name);
    if (!resolved.startsWith(path.resolve('node_modules') + path.sep)) return { error: 'Invalid import path' };
    try { return { contents: fs.readFileSync(resolved, 'utf8') }; } catch { return { error: `Missing import ${name}` }; }
  } }));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  return Object.fromEntries(names.flatMap(file => Object.entries(output.contracts[file]).map(([name, contract]) => [name, {
    contractName: name, compilerVersion: solc.version(), abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`,
    deployedBytecode: `0x${contract.evm.deployedBytecode.object}`, metadata: JSON.parse(contract.metadata),
  }])));
}
