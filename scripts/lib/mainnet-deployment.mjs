import fs from 'node:fs';
import path from 'node:path';
import { Contract, ContractFactory, FetchRequest, JsonRpcProvider, Transaction, Wallet, ZeroAddress, formatEther, getAddress, getCreateAddress, keccak256, parseEther } from 'ethers';
import { compileContracts } from './compile-contracts.mjs';

export const MAINNET_CHAIN_ID = 137;
export const POLYGON_USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
export const mainnetDirectory = '.data/contracts/polygon-mainnet';
export function writeMainnetEnvironment(name,value) {
  const filename='.env.mainnet';
  let source=fs.existsSync(filename)?fs.readFileSync(filename,'utf8'):'';
  const newline=source.includes('\r\n')?'\r\n':'\n',expression=new RegExp(`^${name}=[^\\r\\n]*`,'m');
  source=expression.test(source)?source.replace(expression,()=>`${name}=${value}`):`${source}${source && !source.endsWith('\n')?newline:''}${name}=${value}${newline}`;
  fs.writeFileSync(filename,source,{mode:0o600});process.env[name]=value;
}
export function mainnetConfig(env=process.env) {
  if (env.NUXT_EVM_CHAIN_ID && Number(env.NUXT_EVM_CHAIN_ID)!==137) throw new Error('Mainnet deployment requires NUXT_EVM_CHAIN_ID=137 in .env.mainnet.');
  if (env.NUXT_PUBLIC_CHAIN_ID && Number(env.NUXT_PUBLIC_CHAIN_ID)!==137) throw new Error('NUXT_PUBLIC_CHAIN_ID must be 137 for mainnet.');
  if (env.NUXT_EVM_TOKEN_ADDRESS && getAddress(env.NUXT_EVM_TOKEN_ADDRESS)!==POLYGON_USDT) throw new Error('Mainnet deployment requires the official Polygon USDT address. Mock tokens are not accepted.');
  const missing=[];
  const address=name=>{if(!env[name]){missing.push(name);return null;}let result;try{result=getAddress(env[name]);}catch{throw new Error(`Invalid ${name} in .env.mainnet.`);}if(result===ZeroAddress)throw new Error(`Invalid ${name} in .env.mainnet.`);return result;};
  const keyAddress=name=>{if(!env[name]){missing.push(name);return null;}try{return new Wallet(env[name]).address;}catch{throw new Error(`Invalid ${name} in .env.mainnet.`);}};
  const owner=address('REFERRAL_OWNER_ADDRESS'),feeRecipient=address('REFERRAL_FEE_RECIPIENT_ADDRESS');
  const authority=env.NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY?keyAddress('NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY'):address('REFERRAL_QUOTE_SIGNER_ADDRESS');
  if(env.REFERRAL_QUOTE_SIGNER_ADDRESS && authority && getAddress(env.REFERRAL_QUOTE_SIGNER_ADDRESS)!==authority)throw new Error('Quote signer address does not match the authority key.');
  const deployer=keyAddress('REFERRAL_DEPLOYER_PRIVATE_KEY');
  const confirmations=Number(env.NUXT_REFERRAL_MIN_CONFIRMATIONS||3);
  if(!Number.isSafeInteger(confirmations)||confirmations<2||confirmations>100)throw new Error('Mainnet requires 2 through 100 confirmations.');
  const rpcUrl=env.NUXT_EVM_RPC_URL||'https://polygon.drpc.org';
  if(!/^https?:$/.test(new URL(rpcUrl).protocol))throw new Error('Invalid mainnet RPC URL.');
  const maxGas=env.MAINNET_MAX_DEPLOYMENT_COST_POL||'1';
  if(!/^\d{1,9}(\.\d{1,18})?$/.test(maxGas)||parseEther(maxGas)<=0n)throw new Error('Set a positive MAINNET_MAX_DEPLOYMENT_COST_POL.');
  return {owner,feeRecipient,authority,deployer,confirmations,rpcUrl,maxGas,missing};
}
export function prepareMainnet({initialize=false,env=process.env}={}) {
  mainnetConfig(env);
  if(initialize) {
    const defaults={NUXT_EVM_CHAIN_ID:'137',NUXT_PUBLIC_CHAIN_ID:'137',NUXT_EVM_RPC_URL:'https://polygon.drpc.org',NUXT_EVM_TOKEN_ADDRESS:POLYGON_USDT,NUXT_REFERRAL_CONTRACT_ADDRESS:'',NUXT_REFERRAL_PAYMENT_MODE:'contract',NUXT_REFERRAL_MIN_CONFIRMATIONS:'3',NUXT_EVM_MIN_CONFIRMATIONS:'3',NUXT_PUBLIC_WALLET_MODE:'external',MAINNET_MAX_DEPLOYMENT_COST_POL:'1',REFERRAL_OWNER_ADDRESS:'',REFERRAL_FEE_RECIPIENT_ADDRESS:'',REFERRAL_DEPLOYER_PRIVATE_KEY:'',DATABASE_URL:''};
    for(const [name,value]of Object.entries(defaults))if(!env[name])writeMainnetEnvironment(name,value);
    if(!env.NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY&&!env.REFERRAL_QUOTE_SIGNER_ADDRESS)writeMainnetEnvironment('NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY',Wallet.createRandom().privateKey);
  }
  const config=mainnetConfig(env),artifact=compileContracts({distributorOnly:true}).ReferralDistributor;
  const filename=path.join(mainnetDirectory,'deployment-progress.json');
  const progress=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):null;
  const fingerprint={chainId:137,tokenAddress:POLYGON_USDT,owner:config.owner,feeRecipient:config.feeRecipient,authority:config.authority,deployer:config.deployer,bytecodeHash:keccak256(artifact.bytecode)};
  if(progress && Object.entries(fingerprint).some(([key,value])=>progress[key]!==value))throw new Error('Saved mainnet deployment differs from this configuration/build. Keep its records and resolve the mismatch before deploying.');
  fs.mkdirSync(mainnetDirectory,{recursive:true});
  fs.writeFileSync(path.join(mainnetDirectory,'ReferralDistributor.json'),JSON.stringify(artifact,null,2)+'\n');
  const plan={...fingerprint,network:'Polygon mainnet',mockToken:false,deploys:['ReferralDistributor'],token:{address:POLYGON_USDT,symbol:'USDT / USDT0',decimals:6,existing:true},missing:config.missing,broadcast:false};
  fs.writeFileSync(path.join(mainnetDirectory,'deployment-plan.json'),JSON.stringify(plan,null,2)+'\n');
  return {config,artifact,progress,plan,filename};
}
export async function deployMainnet({broadcast=false,env=process.env,provider: suppliedProvider}={}) {
  const lock=path.join(mainnetDirectory,'deployment.lock');
  let locked=false;
  if(broadcast) {
    fs.mkdirSync(mainnetDirectory,{recursive:true});
    let descriptor;
    try {descriptor=fs.openSync(lock,'wx',0o600);locked=true;fs.writeFileSync(descriptor,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})+'\n');}
    catch(error){if(error.code==='EEXIST')throw new Error('Another mainnet deployment holds deployment.lock. Wait for it to finish; inspect a stale lock before removing it.');throw error;}
    finally{if(descriptor!==undefined)fs.closeSync(descriptor);}
  }
  try {return await executeMainnetDeployment({broadcast,env,provider:suppliedProvider});}
  finally{if(locked)fs.unlinkSync(lock);}
}
async function executeMainnetDeployment({broadcast,env,provider:suppliedProvider}) {
  const prepared=prepareMainnet({env}),{config,artifact,plan,filename}=prepared;
  const request=new FetchRequest(config.rpcUrl);request.timeout=10000;
  const provider=suppliedProvider??new JsonRpcProvider(request,undefined,{cacheTimeout:-1,batchMaxCount:1});
  try {
    if(config.missing.length){if(broadcast)throw new Error(`Set these .env.mainnet fields: ${config.missing.join(', ')}`);return plan;}
    if((await provider.getNetwork()).chainId!==137n)throw new Error('RPC must point to Polygon mainnet (137).');
    if(await provider.getCode(POLYGON_USDT)==='0x')throw new Error('Official Polygon USDT is not deployed on this RPC network.');
    const token=new Contract(POLYGON_USDT,['function decimals() view returns(uint8)','function symbol() view returns(string)'],provider);
    if(await token.decimals()!==6n)throw new Error('Official Polygon USDT must have six decimals.');
    plan.token.symbol=String(await token.symbol()).slice(0,24);
    const wallet=new Wallet(env.REFERRAL_DEPLOYER_PRIVATE_KEY,provider);
    const factory=new ContractFactory(artifact.abi,artifact.bytecode,wallet);
    const deployment=await factory.getDeployTransaction(POLYGON_USDT,config.owner,config.feeRecipient,config.authority);
    let progress=prepared.progress,pending=progress?.transaction;
    const configured=env.NUXT_REFERRAL_CONTRACT_ADDRESS;
    if(configured && (!pending || getAddress(configured)!==getAddress(pending.address)))throw new Error('A different mainnet distributor is already configured. Resolve it before deploying a duplicate.');
    if(pending) {
      const tx=Transaction.from(pending.raw);
      if(tx.to!==null||tx.chainId!==137n||tx.from!==wallet.address||tx.data!==deployment.data||tx.hash!==pending.hash||getCreateAddress({from:wallet.address,nonce:tx.nonce})!==pending.address)throw new Error('Saved mainnet signed transaction does not match this deployment.');
    }
    const receipt=pending?await provider.getTransactionReceipt(pending.hash):null;
    const fees=await provider.getFeeData(),balance=await provider.getBalance(wallet.address);
    const fee=fees.maxFeePerGas??fees.gasPrice;
    if(!fee)throw new Error('Mainnet gas price is unavailable.');
    const gasLimit=pending?Transaction.from(pending.raw).gasLimit:(await provider.estimateGas({...deployment,from:wallet.address}))*120n/100n;
    const gasCap=pending?(Transaction.from(pending.raw).maxFeePerGas??Transaction.from(pending.raw).gasPrice):fee*115n/100n;
    const budget=gasLimit*gasCap;
    plan.gasBudgetPol=formatEther(budget);plan.deployerBalancePol=formatEther(balance);plan.withinGasLimit=budget<=parseEther(config.maxGas);plan.funded=balance>=budget;
    fs.writeFileSync(path.join(mainnetDirectory,'deployment-plan.json'),JSON.stringify(plan,null,2)+'\n');
    if(!broadcast)return plan;
    if(!receipt && (!plan.withinGasLimit||!plan.funded))throw new Error(`Deployment needs up to ${plan.gasBudgetPol} mainnet POL. Fund the deployer or adjust MAINNET_MAX_DEPLOYMENT_COST_POL after reviewing the plan.`);
    if(!pending) {
      const nonce=await provider.getTransactionCount(wallet.address,'pending');
      if(nonce!==await provider.getTransactionCount(wallet.address,'latest'))throw new Error('Wait for the deployer’s outstanding transactions before starting a new deployment.');
      const tx=await wallet.populateTransaction({...deployment,gasLimit,nonce,...(fees.maxFeePerGas?{type:2,maxFeePerGas:gasCap,maxPriorityFeePerGas:fees.maxPriorityFeePerGas??0n}:{type:0,gasPrice:gasCap})});
      const raw=await wallet.signTransaction(tx);
      pending={raw,hash:keccak256(raw),address:getCreateAddress({from:wallet.address,nonce}),nonce};
      progress={chainId:137,tokenAddress:POLYGON_USDT,owner:config.owner,feeRecipient:config.feeRecipient,authority:config.authority,deployer:wallet.address,bytecodeHash:keccak256(artifact.bytecode),transaction:pending};
      fs.writeFileSync(filename,JSON.stringify(progress,null,2)+'\n',{mode:0o600});
    }
    let confirmed=receipt;
    if(!confirmed){try{await provider.broadcastTransaction(pending.raw);}catch{if(!await provider.getTransaction(pending.hash))throw new Error('Mainnet broadcast is indeterminate. Retry the same command; signed bytes are saved.');}}
    if(!confirmed||await confirmed.confirmations()<config.confirmations)confirmed=await provider.waitForTransaction(pending.hash,config.confirmations,120000);
    if(!confirmed)throw new Error('Mainnet deployment is pending. Retry the same command to resume.');
    if(confirmed.status!==1||await provider.getCode(pending.address)==='0x')throw new Error('Mainnet deployment reverted or has no bytecode. Inspect the saved transaction.');
    const distributor=new Contract(pending.address,artifact.abi,provider);
    if(getAddress(await distributor.paymentToken())!==POLYGON_USDT||await distributor.distributionVersion()!==5n||getAddress(await distributor.owner())!==config.owner||getAddress(await distributor.feeRecipient())!==config.feeRecipient||getAddress(await distributor.quoteSigner())!==config.authority)throw new Error('Deployed mainnet contract configuration does not match the plan.');
    writeMainnetEnvironment('NUXT_EVM_CHAIN_ID','137');writeMainnetEnvironment('NUXT_PUBLIC_CHAIN_ID','137');writeMainnetEnvironment('NUXT_EVM_TOKEN_ADDRESS',POLYGON_USDT);writeMainnetEnvironment('NUXT_REFERRAL_CONTRACT_ADDRESS',pending.address);writeMainnetEnvironment('NUXT_REFERRAL_PAYMENT_MODE','contract');
    const result={chainId:137,tokenAddress:POLYGON_USDT,contractAddress:pending.address,transactionHash:pending.hash,explorerUrl:`https://polygonscan.com/address/${pending.address}`,confirmed:true};
    fs.writeFileSync(path.join(mainnetDirectory,'deployment-result.json'),JSON.stringify(result,null,2)+'\n');
    return result;
  } finally {if(!suppliedProvider)provider.destroy();}
}
