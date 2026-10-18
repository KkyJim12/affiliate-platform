import { createPublicClient, erc20Abi, formatUnits, http, parseEventLogs } from "viem";
import type { Address, Hash, Transport } from "viem";
import { bsc, mainnet, polygon, polygonAmoy, sepolia } from "viem/chains";
import { evmAddress, ledgerDecimals, ledgerUnitsToToken, parseTokenAmount, tokenUnitsToLedger } from "../../shared/evm.ts";

export const supportedEvmChains = [mainnet, bsc, polygon, polygonAmoy, sepolia] as const;

export interface EvmConfigInput {
  rpcUrl: string;
  chainId: string | number;
  tokenAddress: string;
  treasuryAddress: string;
  minConfirmations: string | number;
}

export interface EvmConfig {
  rpcUrl: string;
  chainId: number;
  tokenAddress: Address;
  treasuryAddress: Address;
  minConfirmations: number;
}

function positiveInteger(value: string | number, name: string) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw new Error(`${name} must be a positive safe integer.`);
  return Number(value);
}

// An entirely empty configuration keeps blockchain integration optional.
export function resolveEvmConfig(input: EvmConfigInput): EvmConfig | null {
  if ([input.rpcUrl, input.chainId, input.tokenAddress, input.treasuryAddress, input.minConfirmations].every(value => value === "")) return null;
  let url: URL;
  try { url = new URL(input.rpcUrl); }
  catch { throw new Error("Set a valid EVM RPC URL."); }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("EVM RPC must use HTTP or HTTPS.");
  const chainId = positiveInteger(input.chainId, "EVM chain ID");
  if (!supportedEvmChains.some(chain => chain.id === chainId)) throw new Error("Unsupported EVM chain ID. Add its Viem chain definition first.");
  const tokenAddress = evmAddress(input.tokenAddress);
  const treasuryAddress = evmAddress(input.treasuryAddress);
  if (tokenAddress === treasuryAddress) throw new Error("The treasury must differ from the token contract.");
  return { rpcUrl: input.rpcUrl, chainId, tokenAddress, treasuryAddress,
    minConfirmations: positiveInteger(input.minConfirmations, "EVM minimum confirmations") };
}

export interface TransferExpectation {
  hash: string;
  logIndex: number;
  senderAddress: string;
  amount: string;
}

/** Read-only evidence for review; does not establish account ownership or credit a wallet. */
export function createEvmReader(input: EvmConfigInput, transport?: Transport) {
  const config = resolveEvmConfig(input);
  if (!config) throw new Error("EVM integration is not configured.");
  const { chainId, tokenAddress, treasuryAddress, minConfirmations } = config;
  const chain = supportedEvmChains.find(item => item.id === config.chainId)!;
  const client = createPublicClient({ chain, ccipRead: false,
    transport: transport ?? http(config.rpcUrl, { timeout: 10_000, retryCount: 1 }) });

  async function assertChain() {
    if (await client.getChainId() !== chainId) throw new Error("RPC chain ID does not match the configured EVM chain.");
  }

  async function readToken(owner: string) {
    const ownerAddress = evmAddress(owner);
    await assertChain();
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const [decimals, symbol, balance] = await Promise.all([
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals", blockNumber }),
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol", blockNumber }).catch(() => null),
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [ownerAddress], blockNumber }),
    ]);
    return { chainId, tokenAddress, ownerAddress, blockNumber: blockNumber.toString(),
      decimals, symbol, balanceUnits: balance.toString(), balance: formatUnits(balance, decimals) };
  }

  async function readAllowance(owner: string, spender: string) {
    const ownerAddress = evmAddress(owner), spenderAddress = evmAddress(spender);
    await assertChain();
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const allowance = await client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "allowance",
      args: [ownerAddress, spenderAddress], blockNumber });
    return { chainId, tokenAddress, ownerAddress, spenderAddress,
      blockNumber: blockNumber.toString(), allowanceUnits: allowance.toString() };
  }

  async function inspectTransfer(expected: TransferExpectation) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(expected.hash)) throw new Error("Enter a valid EVM transaction hash.");
    if (!Number.isSafeInteger(expected.logIndex) || expected.logIndex < 0) throw new Error("Enter a valid transfer log index.");
    const senderAddress = evmAddress(expected.senderAddress);
    if (senderAddress === treasuryAddress) throw new Error("The treasury cannot fund itself.");
    const ledgerAmount = tokenUnitsToLedger(parseTokenAmount(expected.amount, ledgerDecimals), ledgerDecimals);
    if (ledgerAmount <= 0) throw new Error("The expected transfer amount must be positive.");
    await assertChain();
    const receipt = await client.getTransactionReceipt({ hash: expected.hash as Hash });
    if (receipt.status !== "success") throw new Error("The transaction reverted.");
    const [head, block, decimals] = await Promise.all([
      client.getBlockNumber({ cacheTime: 0 }),
      client.getBlock({ blockNumber: receipt.blockNumber }),
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals", blockNumber: receipt.blockNumber }),
    ]);
    if (block.hash !== receipt.blockHash) throw new Error("The receipt is no longer in the canonical block.");
    const confirmations = head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n;
    if (confirmations < BigInt(minConfirmations)) throw new Error("The transaction needs more confirmations.");
    const logs = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", strict: true,
      logs: receipt.logs.filter(log => log.address.toLowerCase() === tokenAddress.toLowerCase()
        && log.logIndex === expected.logIndex && !log.removed) });
    const transfer = logs[0];
    if (logs.length !== 1 || !transfer) throw new Error("No matching token Transfer event at this log index.");
    if (transfer.args.from.toLowerCase() !== senderAddress.toLowerCase()
      || transfer.args.to.toLowerCase() !== treasuryAddress.toLowerCase())
      throw new Error("The transfer sender or treasury does not match.");
    if (transfer.args.value !== ledgerUnitsToToken(ledgerAmount, decimals)) throw new Error("The transferred amount does not match.");
    const hash = receipt.transactionHash.toLowerCase() as Hash;
    return { chainId, tokenAddress, senderAddress, treasuryAddress,
      hash, logIndex: expected.logIndex, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
      confirmations: confirmations.toString(), tokenAmountUnits: transfer.args.value.toString(), ledgerAmount,
      settlementReference: `evm:${chainId}:${hash}:${expected.logIndex}` };
  }

  return { readToken, readAllowance, inspectTransfer };
}
