import { deployMainnet } from './lib/mainnet-deployment.mjs';
try {
  if(process.argv.slice(2).some(arg=>arg!=='--broadcast'))throw new Error('Usage: npm run contracts:mainnet:deploy -- [--broadcast]');
  const result=await deployMainnet({broadcast:process.argv.includes('--broadcast')});
  console.log(JSON.stringify(result,null,2));
  console.log(result.confirmed?'Polygon mainnet distributor confirmed. .env.mainnet updated.':'Preview only. No transactions were broadcast.');
} catch(error){console.error(error.code?'Mainnet deployment could not be completed. Check saved progress, RPC and POL balance.':error.message);process.exitCode=1;}
