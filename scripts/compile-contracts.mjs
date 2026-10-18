import fs from 'node:fs';
import { compileContracts } from './lib/compile-contracts.mjs';

const artifacts = compileContracts({ includeTests: process.argv.includes('--include-tests') });
fs.mkdirSync('.data/contracts', { recursive: true });
for (const [name, artifact] of Object.entries(artifacts)) {
  fs.writeFileSync(`.data/contracts/${name}.json`, JSON.stringify(artifact, null, 2) + '\n');
  console.log(`${name}: compiled with ${artifact.compilerVersion}, ${(artifact.bytecode.length - 2) / 2} deployment bytes`);
}
