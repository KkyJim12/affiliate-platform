import { Contract, FetchRequest, Interface, JsonRpcProvider, Transaction, Wallet, ZeroAddress, formatUnits, getAddress, keccak256, parseUnits, toUtf8Bytes } from "ethers";
import type { Provider, TransactionRequest } from "ethers";
import type { EvmSendAsset } from "../../shared/evm-send.ts";
import { polygonNetwork, type PolygonChainId } from "../../shared/evm-wallet.ts";

export class EvmSendError extends Error {}
const tokenInterface = new Interface(["function decimals() view returns (uint8)", "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)"]);
export interface EvmSendConfig { rpcUrl: string; chainId?: string | number; tokenAddress?: string; minConfirmations: number }
export interface SendPlan {
  sender: string; recipient: string; asset: EvmSendAsset; tokenAddress: string | null;
  symbol: string; decimals: number; amount: string; units: string; gasBudget: string;
  deadline: number; createdBlock: number;
  tx: { chainId: number; nonce: number; to: string; data: string; value: string; gasLimit: string;
    type: number; maxFeePerGas?: string; maxPriorityFeePerGas?: string; gasPrice?: string };
}
export const sendPlanHash = (plan: SendPlan) => {
  // PostgreSQL JSONB changes property order; the review hash must stay stable.
  const canonical = (value: unknown): unknown => value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return keccak256(toUtf8Bytes(JSON.stringify(canonical(plan))));
};
function recipientAddress(value: string) {
  try { if (getAddress(value) !== ZeroAddress) return getAddress(value); } catch {}
  throw new EvmSendError("recipient");
}
export function sendUnits(value: string, decimals: number) {
  if (typeof value !== "string" || !/^\d{1,78}(\.\d{1,36})?$/.test(value)) throw new EvmSendError("amount");
  try {
    const amount = parseUnits(value, decimals);
    if (amount > 0n && amount < 2n ** 256n) return amount;
  } catch {}
  throw new EvmSendError("amount");
}

export class EvmSendClient {
  readonly chainId: PolygonChainId;
  readonly provider: Provider;
  readonly config: EvmSendConfig;
  constructor(config: EvmSendConfig, provider?: Provider) {
    this.config = config;
    try { this.chainId = polygonNetwork(config.chainId).chainId; }
    catch { throw new EvmSendError("configuration"); }
    if (!/^https?:$/.test(new URL(config.rpcUrl).protocol)
      || !Number.isInteger(config.minConfirmations) || config.minConfirmations < 1 || config.minConfirmations > 100) throw new EvmSendError("configuration");
    if (config.tokenAddress) recipientAddress(config.tokenAddress);
    const request = new FetchRequest(config.rpcUrl); request.timeout = 10000;
    this.provider = provider ?? new JsonRpcProvider(request, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  }
  async network() { if ((await this.provider.getNetwork()).chainId !== BigInt(this.chainId)) throw new EvmSendError("network"); }
  async quote(sender: string, recipient: string, asset: EvmSendAsset, amount: string): Promise<SendPlan> {
    await this.network();
    sender = recipientAddress(sender); recipient = recipientAddress(recipient);
    if (recipient === sender || this.config.tokenAddress && recipient === getAddress(this.config.tokenAddress)) throw new EvmSendError("recipient");
    if (asset !== "native" && asset !== "token") throw new EvmSendError("asset");
    let decimals = 18, symbol = "POL", tokenAddress: string | null = null;
    if (asset === "token") {
      if (!this.config.tokenAddress || await this.provider.getCode(this.config.tokenAddress) === "0x") throw new EvmSendError("token");
      tokenAddress = getAddress(this.config.tokenAddress);
      const token = new Contract(tokenAddress, tokenInterface, this.provider);
      decimals = Number(await token.getFunction("decimals")());
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new EvmSendError("token");
      symbol = String(await token.getFunction("symbol")().catch(() => "ERC-20")).slice(0, 24);
    }
    const units = sendUnits(amount, decimals);
    const [nativeBalance, fees, nonce, head] = await Promise.all([this.provider.getBalance(sender), this.provider.getFeeData(),
      this.provider.getTransactionCount(sender, "pending"), this.provider.getBlock("latest")]);
    if (!head) throw new EvmSendError("unavailable");
    const fee = fees.maxFeePerGas ?? fees.gasPrice;
    if (!fee) throw new EvmSendError("unavailable");
    const feeCap = (fee * 115n + 99n) / 100n;
    if (nativeBalance < (asset === "native" ? units : 0n) + 21000n * feeCap) throw new EvmSendError("gas");
    const data = tokenAddress ? tokenInterface.encodeFunctionData("transfer", [recipient, units]) : "0x";
    const target = tokenAddress ?? recipient;
    if (tokenAddress) {
      const token = new Contract(tokenAddress, tokenInterface, this.provider);
      if (await token.getFunction("balanceOf")(sender) < units) throw new EvmSendError("balance");
    }
    const request = { from: sender, to: target, data, value: asset === "native" ? units : 0n };
    if (tokenAddress) {
      const returned = await this.provider.call(request);
      if (returned !== "0x" && !tokenInterface.decodeFunctionResult("transfer", returned)[0]) throw new EvmSendError("rejected");
    }
    const gasLimit = (await this.provider.estimateGas(request) * 120n + 99n) / 100n;
    const gasBudget = gasLimit * feeCap;
    if (nativeBalance < gasBudget + (asset === "native" ? units : 0n)) throw new EvmSendError("gas");
    return { sender, recipient, asset, tokenAddress, decimals, symbol, amount: formatUnits(units, decimals), units: units.toString(),
      gasBudget: formatUnits(gasBudget, 18), deadline: Date.now() + 300000, createdBlock: head.number,
      tx: { chainId: this.chainId, nonce, to: target, data, value: request.value.toString(), gasLimit: gasLimit.toString(),
        ...(fees.maxFeePerGas ? { type: 2, maxFeePerGas: feeCap.toString(), maxPriorityFeePerGas: (fees.maxPriorityFeePerGas ?? 0n).toString() }
          : { type: 0, gasPrice: feeCap.toString() }) } };
  }
  validate(plan: SendPlan) {
    if (!Number.isInteger(plan.decimals) || plan.decimals < 0 || plan.decimals > 36 || !Number.isSafeInteger(plan.deadline)
      || !Number.isSafeInteger(plan.createdBlock) || ![0, 2].includes(plan.tx.type)) throw new EvmSendError("quote");
    const recipient = recipientAddress(plan.recipient), sender = recipientAddress(plan.sender);
    const units = sendUnits(plan.amount, plan.decimals);
    const token = plan.asset === "token" && this.config.tokenAddress ? getAddress(this.config.tokenAddress) : null;
    if (recipient === sender || recipient === token || plan.tx.chainId !== this.chainId || units.toString() !== plan.units
      || plan.asset !== "native" && plan.asset !== "token" || plan.asset === "token" && (!token || token !== plan.tokenAddress)
      || plan.asset === "native" && (plan.tokenAddress !== null || plan.decimals !== 18)
      || getAddress(plan.tx.to) !== (token ?? recipient)
      || plan.tx.data !== (token ? tokenInterface.encodeFunctionData("transfer", [recipient, units]) : "0x")
      || BigInt(plan.tx.value) !== (token ? 0n : units) || !Number.isSafeInteger(plan.tx.nonce) || plan.tx.nonce < 0
      || BigInt(plan.tx.gasLimit) <= 0n
      || BigInt(plan.tx.maxFeePerGas ?? plan.tx.gasPrice!) <= 0n
      || plan.tx.type === 2 && (BigInt(plan.tx.maxPriorityFeePerGas!) < 0n || BigInt(plan.tx.maxPriorityFeePerGas!) > BigInt(plan.tx.maxFeePerGas!))
      || parseUnits(plan.gasBudget, 18) !== BigInt(plan.tx.gasLimit) * BigInt(plan.tx.maxFeePerGas ?? plan.tx.gasPrice!)) throw new EvmSendError("quote");
    return this.transaction(plan);
  }
  private transaction(plan: SendPlan): TransactionRequest {
    return { ...plan.tx, value: BigInt(plan.tx.value), gasLimit: BigInt(plan.tx.gasLimit),
      ...(plan.tx.type === 2 ? { maxFeePerGas: BigInt(plan.tx.maxFeePerGas!), maxPriorityFeePerGas: BigInt(plan.tx.maxPriorityFeePerGas!) }
        : { gasPrice: BigInt(plan.tx.gasPrice!) }) };
  }
  async prepare(signer: Wallet, plan: SendPlan) {
    await this.network();
    const tx = this.validate(plan);
    if (signer.address !== getAddress(plan.sender) || plan.deadline < Date.now()) throw new EvmSendError("expired");
    if (await this.provider.getTransactionCount(signer.address, "pending") !== plan.tx.nonce) throw new EvmSendError("expired");
    // Recheck funds, recipient execution and prices before signing the reviewed quote.
    const fresh = await this.quote(plan.sender, plan.recipient, plan.asset, plan.amount);
    if (fresh.tx.nonce !== plan.tx.nonce || fresh.decimals !== plan.decimals || BigInt(fresh.tx.gasLimit) > BigInt(plan.tx.gasLimit)
      || BigInt(fresh.tx.maxFeePerGas ?? fresh.tx.gasPrice!) > BigInt(plan.tx.maxFeePerGas ?? plan.tx.gasPrice!)) throw new EvmSendError("expired");
    const feeCap = BigInt(plan.tx.maxFeePerGas ?? plan.tx.gasPrice!);
    if (await this.provider.getBalance(signer.address) < BigInt(plan.tx.value) + BigInt(plan.tx.gasLimit) * feeCap) throw new EvmSendError("gas");
    const raw = await signer.signTransaction(tx);
    return { raw, hash: keccak256(raw) };
  }
  async broadcast(raw: string, plan: SendPlan) {
    await this.network(); this.validate(plan);
    const tx = Transaction.from(raw);
    if (tx.from !== getAddress(plan.sender) || tx.chainId !== BigInt(this.chainId) || tx.to !== getAddress(plan.tx.to)
      || tx.data !== plan.tx.data || tx.value !== BigInt(plan.tx.value) || tx.nonce !== plan.tx.nonce
      || tx.gasLimit !== BigInt(plan.tx.gasLimit) || tx.maxFeePerGas !== (plan.tx.maxFeePerGas ? BigInt(plan.tx.maxFeePerGas) : null)
      || tx.maxPriorityFeePerGas !== (plan.tx.maxPriorityFeePerGas ? BigInt(plan.tx.maxPriorityFeePerGas) : null)
      || tx.type !== plan.tx.type || tx.type === 0 && tx.gasPrice !== BigInt(plan.tx.gasPrice!)) throw new EvmSendError("quote");
    if (!await this.provider.getTransactionReceipt(tx.hash!)) await this.provider.broadcastTransaction(raw);
  }
  async verify(hash: string, plan: SendPlan) {
    await this.network(); this.validate(plan);
    const receipt = await this.provider.getTransactionReceipt(hash);
    if (!receipt || await receipt.confirmations() < this.config.minConfirmations) return null;
    if ((await this.provider.getBlock(receipt.blockNumber))?.hash !== receipt.blockHash) return null;
    const tx = await this.provider.getTransaction(hash);
    if (!tx || tx.chainId !== BigInt(this.chainId) || tx.from !== getAddress(plan.sender) || tx.to !== getAddress(plan.tx.to)
      || tx.value !== BigInt(plan.tx.value) || tx.data !== plan.tx.data || tx.nonce !== plan.tx.nonce) throw new EvmSendError("quote");
    if (receipt.status !== 1) return { status: "failed" as const, receipt };
    if (plan.tokenAddress) {
      const paid = receipt.logs.flatMap(log => {
        if (getAddress(log.address) !== getAddress(plan.tokenAddress!)) return [];
        try { const event = tokenInterface.parseLog(log); return event?.name === "Transfer" ? [event] : []; } catch { return []; }
      }).filter(event => getAddress(event.args.from) === getAddress(plan.sender) && getAddress(event.args.to) === getAddress(plan.recipient) && event.args.value === BigInt(plan.units));
      if (paid.length !== 1) throw new EvmSendError("evidence");
    }
    return { status: "confirmed" as const, receipt };
  }
}
