import { AbiCoder, Contract, FetchRequest, Interface, JsonRpcProvider, Transaction, Wallet, ZeroAddress, ZeroHash, formatUnits, getAddress, keccak256, parseUnits } from "ethers";
import type { Provider, TransactionReceipt } from "ethers";
import { purchaseTypes, qualificationTypes, referralContractAbi, type ChainPurchaseQuote } from "../../shared/referral-contract.ts";
import { purchaseShares, shareRecipientIndex, remainingLevelPrice, ledgerScale } from "../../shared/compensation.ts";
import { legacyPurchaseShares, version2PurchaseShares, version2RecipientDepth } from "./legacy-distribution.ts";
import { polygonNetwork, type PolygonChainId } from "../../shared/evm-wallet.ts";

export const tokenAbi = ["function decimals() view returns (uint8)", "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"];
export interface ReferralChainConfig {
  chainId?: string | number;
  rpcUrl: string; contractAddress: string; tokenAddress: string; authorityPrivateKey: string; minConfirmations: number;
  minGasBalance?: string;
}
// Covers all 19 payouts, including fifteen recipients with empty token balances.
// The fee cap has a separate 15% buffer above the RPC's current price.
const purchaseGasLimit = 1_400_000n;
const approvalGasLimit = 60_000n;
const bufferedGasPrice = (price: bigint) => (price * 115n + 99n) / 100n;
export interface PurchasePayload {
  createdBlock: number;
  quote: ChainPurchaseQuote;
  uplines: string[];
  recipients: { userId: string | null; reason: "upline" | "missing_upline" | "ineligible_upline" }[];
  signature: string;
  automaticApproval?: boolean;
  rebirth?: boolean;
}
export interface PreparedChainTransaction { stage: string; hash: string; raw: string; nonce: number; to: string }
export interface QualificationPayload { member:string;configNonce:string;signature:string }
export const distributorInterface = new Interface(referralContractAbi);
const legacyDistributorInterface = new Interface([
  "function purchase((bytes32 id,address buyer,uint8 level,uint8 previousLevel,bytes32 uplinesHash,address feeRecipient,uint256 configNonce,uint256 deadline) quote,address[15] uplines,bytes signature)",
]);
const version3DistributorInterface = new Interface(["purchase", "autoUpgrade", "rebirth"].map(method =>
  `function ${method}((bytes32 id,address buyer,uint8 level,uint8 previousLevel,bytes32 uplinesHash,address feeRecipient,uint256 configNonce,uint256 deadline,bytes32 matrixCycle) quote,address[18] uplines,bytes signature)`));

export function uplineHash(uplines: string[]) {
  return keccak256(AbiCoder.defaultAbiCoder().encode([uplines.length === 18 ? "address[18]" : "address[15]"], [uplines]));
}

export class ReferralChainClient {
  readonly chainId: PolygonChainId;
  readonly provider: Provider;
  readonly contract: Contract;
  readonly token: Contract;
  readonly authority: Wallet;
  readonly config: ReferralChainConfig;
  readonly minimumGasBalance: bigint;
  constructor(config: ReferralChainConfig, provider?: Provider) {
    this.chainId = polygonNetwork(config.chainId).chainId;
    this.config = config;
    const minimum = String(config.minGasBalance ?? "0.003");
    if (!/^\d{1,9}(\.\d{1,18})?$/.test(minimum)) throw new Error("Invalid minimum POL balance configuration.");
    this.minimumGasBalance = parseUnits(minimum, 18);
    if (!/^https?:$/.test(new URL(config.rpcUrl).protocol)) throw new Error("Invalid referral RPC configuration.");
    if (!Number.isSafeInteger(config.minConfirmations) || config.minConfirmations < 1 || config.minConfirmations > 100)
      throw new Error("Invalid referral confirmation policy.");
    if (getAddress(config.contractAddress) === ZeroAddress || getAddress(config.tokenAddress) === ZeroAddress
      || getAddress(config.contractAddress) === getAddress(config.tokenAddress)) throw new Error("Invalid referral contract configuration.");
    const request = new FetchRequest(config.rpcUrl); request.timeout = 10_000;
    this.provider = provider ?? new JsonRpcProvider(request, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
    this.contract = new Contract(config.contractAddress, referralContractAbi, this.provider);
    this.token = new Contract(config.tokenAddress, tokenAbi, this.provider);
    this.authority = new Wallet(config.authorityPrivateKey);
  }

  async inspect(buyer?: string, nextLevel?: number | null, includeGas = true) {
    if ((await this.provider.getNetwork()).chainId !== BigInt(this.chainId)) throw new Error("Referral RPC must match the configured Polygon network.");
    if (await this.provider.getCode(this.config.contractAddress) === "0x") throw new Error("Referral contract is not deployed.");
    if (await this.contract.getFunction("distributionVersion")().catch(() => 0n) !== 4n)
      throw new Error("Deploy the updated referral contract with two-paid-referral commission holds before accepting purchases.");
    const [token, decimals, actualDecimals, feeRecipient, owner, quoteSigner, nonce, paused, symbol, gasFees] = await Promise.all([
      this.contract.getFunction("paymentToken")(), this.contract.getFunction("tokenDecimals")(), this.token.getFunction("decimals")(), this.contract.getFunction("feeRecipient")(),
      this.contract.getFunction("owner")(), this.contract.getFunction("quoteSigner")(), this.contract.getFunction("configNonce")(), this.contract.getFunction("paused")(),
      this.token.getFunction("symbol")().catch(() => "ERC-20"), includeGas ? this.provider.getFeeData() : null,
    ]);
    if (getAddress(token) !== getAddress(this.config.tokenAddress) || decimals !== actualDecimals || decimals < 6n || decimals > 18n
      || getAddress(quoteSigner) !== this.authority.address) throw new Error("Referral deployment configuration does not match the contract.");
    const [balance, gasBalance, currentLevel, allowance] = buyer ? await Promise.all([
      this.token.getFunction("balanceOf")(buyer), includeGas ? this.provider.getBalance(buyer) : null, this.contract.getFunction("levelOf")(buyer),
      includeGas ? this.token.getFunction("allowance")(buyer, this.config.contractAddress) : null,
    ]) : [null, null, null, null];
    let gasBudget: bigint | null = null;
    if (includeGas) {
      const gasPrice = gasFees?.maxFeePerGas ?? gasFees?.gasPrice;
      if (!gasPrice) throw new Error("Gas estimate is unavailable.");
      const level = nextLevel ?? Math.min(Number(currentLevel || 0) + 1, 15);
      const price = BigInt(purchaseShares(level).reduce((sum, share) => sum + share.units, 0)) * 10n ** BigInt(Number(decimals) - 6);
      const approvals = allowance === null ? 2n : allowance >= price ? 0n : allowance > 0n ? 2n : 1n;
      const estimatedBudget = (purchaseGasLimit + approvals * approvalGasLimit) * bufferedGasPrice(gasPrice);
      gasBudget = estimatedBudget > this.minimumGasBalance ? estimatedBudget : this.minimumGasBalance;
    }
    return { feeRecipient: getAddress(feeRecipient), owner: getAddress(owner), decimals: Number(decimals), tokenSymbol: String(symbol).slice(0, 24),
      gasBudget: gasBudget === null ? null : formatUnits(gasBudget, 18),
      configNonce: nonce.toString(), paused: Boolean(paused), balance: balance === null ? null : formatUnits(balance, decimals),
      gasBalance: gasBalance === null ? null : formatUnits(gasBalance, 18), currentLevel: currentLevel === null ? null : Number(currentLevel) };
  }

  async sign(quote: ChainPurchaseQuote) {
    return this.authority.signTypedData({ name: "UNXO Referral Distributor", version: "1", chainId: this.chainId,
      verifyingContract: this.config.contractAddress }, purchaseTypes, quote);
  }

  // Sign the complete nonce-ordered batch before any broadcast. Persisting these
  // exact signed bytes makes restart/retry recovery independent of passwords.
  async preparePurchase(buyer: Wallet, payload: PurchasePayload, decimals: number): Promise<PreparedChainTransaction[]> {
    return this.prepareBatch(buyer, await this.purchaseCalls(buyer.address, payload, decimals));
  }

  // No private key, nonce, gas quote, or native-balance precheck is needed here.
  async purchaseCalls(buyer: string, payload: PurchasePayload, decimals: number) {
    const price = BigInt(purchaseShares(payload.quote.level).reduce((sum, share) => sum + share.units, 0)) * 10n ** BigInt(decimals - 6);
    if (await this.token.getFunction("balanceOf")(buyer) < price) throw new Error("INSUFFICIENT_TOKEN");
    const allowance: bigint = await this.token.getFunction("allowance")(buyer, this.config.contractAddress);
    const calls: { stage: string; to: string; data: string; gasLimit: bigint }[] = [];
    const tokenInterface = new Interface(tokenAbi);
    const approval = payload.automaticApproval ? BigInt(remainingLevelPrice(payload.quote.level) * ledgerScale) * 10n ** BigInt(decimals - 6) : price;
    if (allowance < approval) {
      if (allowance > 0n) calls.push({ stage: "approval_reset", to: this.config.tokenAddress, data: tokenInterface.encodeFunctionData("approve", [this.config.contractAddress, 0]), gasLimit: approvalGasLimit });
      calls.push({ stage: "approval", to: this.config.tokenAddress, data: tokenInterface.encodeFunctionData("approve", [this.config.contractAddress, approval]), gasLimit: approvalGasLimit });
    }
    calls.push({ stage: "purchase", to: this.config.contractAddress, data: distributorInterface.encodeFunctionData("purchase", [payload.quote, payload.uplines, payload.signature]), gasLimit: purchaseGasLimit });
    return calls;
  }

  async prepareAutoUpgrade(payload: PurchasePayload, decimals: number) {
    if (payload.rebirth && await this.contract.getFunction("rebirthVersion")().catch(() => 0n) !== 1n)
      throw new Error("Waiting for deployment of the referral contract with paid reborn support.");
    const price = BigInt(purchaseShares(payload.quote.level).reduce((sum, share) => sum + share.units, 0)) * 10n ** BigInt(decimals - 6);
    if (await this.token.getFunction("balanceOf")(payload.quote.buyer) < price) throw new Error("Waiting for sufficient token balance.");
    if (await this.token.getFunction("allowance")(payload.quote.buyer, this.config.contractAddress) < price) throw new Error("Waiting for token approval for automatic upgrades.");
    return this.prepareBatch(this.authority, [{ stage: "purchase", to: this.config.contractAddress,
      data: distributorInterface.encodeFunctionData(payload.rebirth ? "rebirth" : "autoUpgrade", [payload.quote, payload.uplines, payload.signature]), gasLimit: purchaseGasLimit }]);
  }

  async prepareFeeUpdate(owner: Wallet, recipient: string, maxGasFee: bigint) {
    return this.prepareBatch(owner, [{ stage: "fee_update", to: this.config.contractAddress,
      data: distributorInterface.encodeFunctionData("setFeeRecipient", [getAddress(recipient)]), gasLimit: 100_000n }], maxGasFee);
  }

  async prepareQualification(member: string) {
    const state=await this.inspect(undefined,undefined,false);
    if(state.paused) throw new Error('Commission releases are paused.');
    const value={member:getAddress(member),configNonce:state.configNonce};
    const signature=await this.authority.signTypedData({name:'UNXO Referral Distributor',version:'1',chainId:this.chainId,
      verifyingContract:this.config.contractAddress},qualificationTypes,value);
    const payload:QualificationPayload={...value,signature};
    const prepared=await this.prepareBatch(this.authority,[{stage:'qualification',to:this.config.contractAddress,
      data:distributorInterface.encodeFunctionData('qualifyCommission',[payload.member,payload.configNonce,payload.signature]),gasLimit:200_000n}]);
    return {payload,prepared};
  }

  async verifyQualification(hash:string,payload:QualificationPayload) {
    const receipt=await this.finalizedReceipt(hash);
    if(!receipt) return null;
    if(receipt.status!==1) return {status:'failed' as const,receipt,releases:[]};
    const tx=await this.provider.getTransaction(receipt.hash);
    if(!tx || tx.chainId!==BigInt(this.chainId) || tx.value!==0n || !tx.to || getAddress(tx.to)!==getAddress(this.config.contractAddress)
      || tx.data!==distributorInterface.encodeFunctionData('qualifyCommission',[payload.member,payload.configNonce,payload.signature]))
      throw new Error('Qualification transaction does not match its authorization.');
    const releases=this.events(receipt).filter(event=>event.name==='HeldCommissionReleased').map(event=>({
      recipient:getAddress(event.args.member),amount:event.args.amount.toString() as string,logIndex:event.logIndex,
    }));
    if(releases.length>1 || releases.some(row=>row.recipient!==getAddress(payload.member))) throw new Error('Invalid commission release.');
    return {status:'confirmed' as const,receipt,releases};
  }

  private async prepareBatch(wallet: Wallet, calls: { stage: string; to: string; data: string; gasLimit: bigint }[], maxGasFee?: bigint) {
    if ((await this.provider.getNetwork()).chainId !== BigInt(this.chainId)) throw new Error("Referral RPC must match the configured Polygon network.");
    const [nonce, fees] = await Promise.all([
      this.provider.getTransactionCount(wallet.address, "pending"), this.provider.getFeeData(),
    ]);
    const fee = fees.maxFeePerGas ?? fees.gasPrice;
    if (!fee) throw new Error("Gas pricing is unavailable.");
    const feeLimit = bufferedGasPrice(fee);
    // Administrative updates still require an approved gas budget. Purchases
    // are signed without a native-balance precheck or a caller-supplied quote.
    if (maxGasFee !== undefined) {
      const gasBudget = calls.reduce((sum, call) => sum + call.gasLimit, 0n) * feeLimit;
      if (gasBudget > maxGasFee) throw new Error("GAS_PRICE_CHANGED");
      if (await this.provider.getBalance(wallet.address) < gasBudget) throw new Error("INSUFFICIENT_GAS");
    }
    const result: PreparedChainTransaction[] = [];
    for (const [index, call] of calls.entries()) {
      const transaction = { to: call.to, data: call.data, gasLimit: call.gasLimit, nonce: nonce + index, chainId: this.chainId, value: 0n,
        ...(fees.maxFeePerGas ? { type: 2, maxFeePerGas: feeLimit, maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n }
          : { type: 0, gasPrice: feeLimit }) };
      const raw = await wallet.signTransaction(transaction);
      result.push({ stage: call.stage, hash: keccak256(raw), raw, nonce: nonce + index, to: call.to });
    }
    return result;
  }

  async broadcast(raw: string) {
    const decoded = Transaction.from(raw);
    if (decoded.chainId !== BigInt(this.chainId) || decoded.value !== 0n || ![this.config.contractAddress, this.config.tokenAddress].some(address => getAddress(address) === decoded.to))
      throw new Error("Invalid persisted referral transaction.");
    // Re-broadcasts reuse the exact signed transaction/hash, never a new nonce.
    if (await this.provider.getTransactionReceipt(decoded.hash!)) return;
    await this.provider.broadcastTransaction(raw);
  }

  async finalizedReceipt(hash: string) {
    if ((await this.provider.getNetwork()).chainId !== BigInt(this.chainId)) throw new Error("Unexpected referral network.");
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (!receipt || await receipt.confirmations() < this.config.minConfirmations) return null;
    const canonical = await this.provider.getBlock(receipt.blockNumber);
    if (!canonical || canonical.hash !== receipt.blockHash) return null;
    return receipt;
  }

  async verifyPurchase(hash: string | null, payload: PurchasePayload) {
    let receipt = hash ? await this.finalizedReceipt(hash) : null;
    // A wallet can replace a transaction's gas price, changing its hash. The
    // signed purchase ID still identifies the one authorized distribution.
    if (!receipt && await this.contract.getFunction("purchased")(payload.quote.id)) {
      const head = await this.provider.getBlockNumber();
      for (let from = payload.createdBlock; from <= head; from += 2000) {
        const logs = await this.provider.getLogs({ address: this.config.contractAddress, fromBlock: from,
          toBlock: Math.min(head, from + 1999), topics: [distributorInterface.getEvent("PurchaseCompleted")!.topicHash, payload.quote.id] });
        if (logs[0]) { receipt = await this.finalizedReceipt(logs[0].transactionHash); break; }
      }
    }
    if (!receipt) return null;
    if (receipt.status !== 1) return { status: "failed" as const, receipt };
    const version = await this.contract.getFunction("distributionVersion")().catch(() => 1n);
    const tx = await this.provider.getTransaction(receipt.hash);
    const automatic = version >= 3n && payload.quote.matrixCycle !== ZeroHash;
    const purchaseInterface = version >= 4n ? distributorInterface : version === 3n ? version3DistributorInterface : legacyDistributorInterface;
    const expectedData = purchaseInterface.encodeFunctionData(payload.rebirth ? "rebirth" : automatic ? "autoUpgrade" : "purchase", [payload.quote, payload.uplines, payload.signature]);
    if (!tx || tx.chainId !== BigInt(this.chainId) || tx.value !== 0n || (!automatic && getAddress(tx.from) !== getAddress(payload.quote.buyer))
      || !tx.to || getAddress(tx.to) !== getAddress(this.config.contractAddress) || tx.data !== expectedData) throw new Error("Purchase transaction does not match its authorization.");
    const events = this.events(receipt);
    const completion = events.filter(event => event.name === "PurchaseCompleted");
    if (completion.length !== 1 || completion[0]!.args.id !== payload.quote.id || Number(completion[0]!.args.level) !== payload.quote.level
      || getAddress(completion[0]!.args.buyer) !== getAddress(payload.quote.buyer)
      || Number(completion[0]!.args.previousLevel) !== payload.quote.previousLevel || completion[0]!.args.uplinesHash !== uplineHash(payload.uplines)
      || getAddress(completion[0]!.args.feeRecipient) !== getAddress(payload.quote.feeRecipient)
      || completion[0]!.args.configNonce.toString() !== payload.quote.configNonce) throw new Error("Invalid purchase completion event.");
    const decimals = Number(await this.contract.getFunction("tokenDecimals")());
    const multiplier = 10n ** BigInt(decimals - 6);
    const expected = version >= 3n ? purchaseShares(payload.quote.level) : version === 2n ? version2PurchaseShares(payload.quote.level) : legacyPurchaseShares(payload.quote.level);
    if (completion[0]!.args.amount !== expected.reduce((sum, share) => sum + BigInt(share.units), 0n) * multiplier)
      throw new Error("Invalid purchase amount.");
    const shares = events.filter(event => event.name === "SharePaid" || version >= 4n && event.name === "ShareHeld");
    if (shares.length !== 19) throw new Error("Incomplete purchase distribution.");
    const allocations = expected.map((share, index) => {
      const actual = shares[index]!;
      const held = actual.name === "ShareHeld";
      const position = version >= 3n ? shareRecipientIndex(share) : share.depth - 1;
      const recipientDepth = version >= 3n ? (position >= 0 && payload.uplines[position] !== ZeroAddress ? share.depth : 0)
        : version === 2n ? version2RecipientDepth(share, payload.uplines)
        : share.depth && payload.uplines[share.depth - 1] !== ZeroAddress ? share.depth : 0;
      const recipient = recipientDepth ? payload.uplines[version >= 3n ? position : recipientDepth - 1]! : payload.quote.feeRecipient;
      const redirected = share.kind !== "platform" && recipientDepth !== share.depth;
      if (actual.args.id !== payload.quote.id || Number(actual.args.kind) !== (share.kind === "direct" ? 0 : share.kind === "bonus" ? 1 : 2)
        || Number(actual.args.depth) !== share.depth || actual.args.amount !== BigInt(share.units) * multiplier
        || getAddress(actual.args.recipient) !== getAddress(recipient) || (held ? redirected || share.kind === "platform" : actual.args.redirected !== redirected))
        throw new Error("Purchase allocation does not match its authorization.");
      return { ...share, recipientDepth, recipient: getAddress(recipient), redirected, held, logIndex: actual.logIndex };
    });
    const releases = events.filter(event=>event.name === "HeldCommissionReleased").map(event=>({
      recipient:getAddress(event.args.member),amount:event.args.amount.toString() as string,logIndex:event.logIndex,
    }));
    return { status: "confirmed" as const, receipt, allocations, releases };
  }

  async verifyFeeUpdate(hash: string, owner: string, recipient: string) {
    const receipt = await this.finalizedReceipt(hash);
    if (!receipt) return null;
    if (receipt.status !== 1) return { status: "failed" as const, receipt };
    const tx = await this.provider.getTransaction(hash);
    const events = this.events(receipt).filter(event => event.name === "FeeRecipientChanged");
    if (!tx || getAddress(tx.from) !== getAddress(owner) || !tx.to || getAddress(tx.to) !== getAddress(this.config.contractAddress)
      || tx.data !== distributorInterface.encodeFunctionData("setFeeRecipient", [getAddress(recipient)])
      || events.length !== 1 || getAddress(events[0]!.args.recipient) !== getAddress(recipient)) throw new Error("Invalid fee address update receipt.");
    return { status: "confirmed" as const, receipt };
  }

  private events(receipt: TransactionReceipt) {
    return receipt.logs.flatMap(log => {
      if (getAddress(log.address) !== getAddress(this.config.contractAddress)) return [];
      try { const event = distributorInterface.parseLog(log); return event ? [{ ...event, logIndex: log.index }] : []; }
      catch { return []; }
    });
  }
}
