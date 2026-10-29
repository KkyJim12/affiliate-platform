import { prepareMainnet, mainnetDirectory } from './lib/mainnet-deployment.mjs';
try {
  if(process.argv.length>2)throw new Error('Usage: npm run contracts:mainnet:prepare');
  const {plan}=prepareMainnet({initialize:true});
  console.log(JSON.stringify(plan,null,2));
  console.log(`Prepared .env.mainnet and ${mainnetDirectory}. No transactions were sent.`);
} catch(error){console.error(error.code?'Mainnet preparation failed. Check configuration.':error.message);process.exitCode=1;}
