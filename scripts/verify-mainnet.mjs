import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { AbiCoder, FetchRequest, JsonRpcProvider, Transaction, getAddress, getCreateAddress, keccak256, toUtf8Bytes } from 'ethers';
import { EtherscanVerifier, safeVerificationMessage } from './lib/referral-verification.mjs';
import { mainnetDirectory, mainnetConfig, POLYGON_USDT } from './lib/mainnet-deployment.mjs';

const dryRun=process.argv.includes('--dry-run');
let provider;
const apiKey=process.env.ETHERSCAN_API_KEY||process.env.NUXT_EVM_EXPLORER_API_KEY||'';
try {
  if(process.argv.slice(2).some(arg=>arg!=='--dry-run'))throw new Error('Usage: npm run contracts:mainnet:verify -- [--dry-run]');
  const config=mainnetConfig();
  const progress=JSON.parse(fs.readFileSync(path.join(mainnetDirectory,'deployment-progress.json'),'utf8'));
  const artifact=JSON.parse(fs.readFileSync(path.join(mainnetDirectory,'ReferralDistributor.json'),'utf8'));
  if(artifact.compilerVersion!==solc.version())throw new Error('Restore the deployment compiler before verification.');
  const tx=Transaction.from(progress.transaction.raw),address=getAddress(process.env.NUXT_REFERRAL_CONTRACT_ADDRESS||'');
  const args=AbiCoder.defaultAbiCoder().encode(['address','address','address','address'],[POLYGON_USDT,progress.owner,progress.feeRecipient,progress.authority]).slice(2);
  if(tx.chainId!==137n||tx.to!==null||tx.hash!==progress.transaction.hash||tx.data!==artifact.bytecode+args||getCreateAddress({from:tx.from,nonce:tx.nonce})!==address)throw new Error('Saved mainnet deployment does not match the configured address and artifact.');
  const sources={};
  for(const [name,metadata]of Object.entries(artifact.metadata.sources)) {
    const base=path.resolve(name.startsWith('@openzeppelin/')?'node_modules':'.'),filename=path.resolve(base,name);
    if(!filename.startsWith(base+path.sep))throw new Error('Invalid verification source path.');
    const content=fs.readFileSync(filename,'utf8');
    if(keccak256(toUtf8Bytes(content))!==metadata.keccak256)throw new Error('Source changed since mainnet deployment. Restore the deployed sources.');
    sources[name]={content};
  }
  const {compilationTarget,...settings}=artifact.metadata.settings;
  settings.outputSelection={'*':{'*':['abi','evm.bytecode.object']}};
  const input={language:'Solidity',sources,settings};
  const compilation=JSON.parse(solc.compile(JSON.stringify(input)));
  const sourceName=Object.keys(compilationTarget)[0];
  if('0x'+compilation.contracts?.[sourceName]?.ReferralDistributor?.evm?.bytecode?.object!==artifact.bytecode)throw new Error('Mainnet verification bytecode mismatch.');
  const job={name:'ReferralDistributor',address,input,compilerVersion:'v'+artifact.metadata.compiler.version,contractName:`${sourceName}:ReferralDistributor`,constructorArguments:args};
  const directory=path.join(mainnetDirectory,'verification');fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'ReferralDistributor.standard-input.json'),JSON.stringify(input,null,2)+'\n');
  fs.writeFileSync(path.join(directory,'ReferralDistributor.constructor-args.txt'),args+'\n');
  if(dryRun)console.log('Mainnet verification inputs prepared. No explorer requests or transactions were sent.');
  else {
    const request=new FetchRequest(config.rpcUrl);request.timeout=10000;provider=new JsonRpcProvider(request,undefined,{batchMaxCount:1});
    if((await provider.getNetwork()).chainId!==137n||await provider.getCode(address)==='0x')throw new Error('Configured distributor is not deployed on Polygon mainnet.');
    const verifier=new EtherscanVerifier({apiKey,chainId:137});
    const statusFile=path.join(directory,'status.json'),fingerprint=keccak256(toUtf8Bytes(JSON.stringify(job)));
    const previous=fs.existsSync(statusFile)?JSON.parse(fs.readFileSync(statusFile,'utf8')):{};
    const result=await verifier.verify(job,{guid:previous.fingerprint===fingerprint&&previous.status==='pending'?previous.guid:undefined,onSubmitted(guid){fs.writeFileSync(statusFile,JSON.stringify({fingerprint,status:'pending',guid},null,2)+'\n');}});
    fs.writeFileSync(statusFile,JSON.stringify({fingerprint,...result},null,2)+'\n');
    console.log(`ReferralDistributor ${result.status}: https://polygonscan.com/address/${address}#code`);
  }
} catch(error){console.error(error.code?'Mainnet verification could not be completed. Check the deployment records and configuration.':safeVerificationMessage(error.message,apiKey));process.exitCode=1;}
finally {provider?.destroy();}
