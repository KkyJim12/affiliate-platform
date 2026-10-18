import assert from "node:assert/strict";
import test from "node:test";
import { custom, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, erc20Abi, maxUint256, toHex, zeroAddress } from "viem";
import { createEvmReader, resolveEvmConfig } from "../server/lib/evm.ts";
import { evmAddress, ledgerUnitsToToken, parseTokenAmount, tokenUnitsToLedger } from "../shared/evm.ts";

const tokenAddress = "0x1111111111111111111111111111111111111111";
const treasuryAddress = "0x2222222222222222222222222222222222222222";
const senderAddress = "0x3333333333333333333333333333333333333333";
const otherAddress = "0x4444444444444444444444444444444444444444";
const hash = `0x${"ab".repeat(32)}`;
const blockHash = `0x${"cd".repeat(32)}`;
const config = { rpcUrl: "http://127.0.0.1:8545", chainId: "137", tokenAddress, treasuryAddress, minConfirmations: "6" };
const expectation = { hash, logIndex: 2, senderAddress, amount: "12.345678" };

test("optional configuration rejects partial values, unknown chains, bad addresses and weak confirmation input", () => {
  assert.equal(resolveEvmConfig({ rpcUrl: "", chainId: "", tokenAddress: "", treasuryAddress: "", minConfirmations: "" }), null);
  assert.equal(resolveEvmConfig(config).chainId, 137);
  assert.equal(resolveEvmConfig({ ...config, chainId: "80002" }).chainId, 80002);
  for (const changes of [{ rpcUrl: "" }, { rpcUrl: "file:///test" }, { chainId: "999" }, { chainId: "1.0" },
    { tokenAddress: zeroAddress }, { treasuryAddress: "LW-internal-id" }, { treasuryAddress: tokenAddress },
    { minConfirmations: "" }, { minConfirmations: "0" }, { minConfirmations: "1e2" }, { minConfirmations: "9007199254740992" }]) {
    assert.throws(() => resolveEvmConfig({ ...config, ...changes }));
  }
  assert.throws(() => evmAddress("0x52908400098527886E0F7030069857D2E4169Ee7"));
});

test("token parsing and ledger conversions preserve exact amounts at different precisions", () => {
  assert.equal(parseTokenAmount("12.345678", 6), 12345678n);
  assert.equal(parseTokenAmount("12.345678", 18), 12345678000000000000n);
  assert.equal(tokenUnitsToLedger(12345678000000000000n, 18), 12345678);
  assert.equal(tokenUnitsToLedger(1234n, 2), 12340000);
  assert.equal(ledgerUnitsToToken(12345678, 18), 12345678000000000000n);
  assert.equal(ledgerUnitsToToken(12000000, 0), 12n);
  assert.equal(tokenUnitsToLedger(0n, 18), 0);
  assert.equal(tokenUnitsToLedger(BigInt(Number.MAX_SAFE_INTEGER), 6), Number.MAX_SAFE_INTEGER);
  for (const value of ["1.0000001", "1.0000000", "-1", "+1", "1e3", " 1", "1.", ".1", ""]) {
    assert.throws(() => parseTokenAmount(value, 6));
  }
  assert.throws(() => parseTokenAmount((maxUint256 + 1n).toString(), 0));
  assert.throws(() => tokenUnitsToLedger(1000000000001n, 18), /exactly/);
  assert.throws(() => tokenUnitsToLedger(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 6), /safe integer/);
  assert.throws(() => tokenUnitsToLedger(-1n, 6));
  assert.throws(() => ledgerUnitsToToken(1, 2));
  assert.throws(() => ledgerUnitsToToken(1.5, 18));
  assert.throws(() => parseTokenAmount("1", 256));
});

function fixture(overrides = {}) {
  const options = { chainId: 137, head: 105, decimals: 18, status: "0x1", logAddress: tokenAddress,
    from: senderAddress, to: treasuryAddress, value: 12345678000000000000n, canonicalHash: blockHash,
    removed: false, symbolFails: false, ...overrides };
  const log = { address: options.logAddress, blockHash, blockNumber: "0x64", transactionHash: hash,
    transactionIndex: "0x0", logIndex: "0x2", removed: options.removed,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: options.from, to: options.to } }),
    data: encodeAbiParameters([{ type: "uint256" }], [options.value]) };
  const receipt = { transactionHash: hash, transactionIndex: "0x0", blockHash, blockNumber: "0x64", from: senderAddress,
    to: tokenAddress, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", contractAddress: null,
    logs: [log], logsBloom: `0x${"00".repeat(256)}`, status: options.status, effectiveGasPrice: "0x1", type: "0x2" };
  const calls = [];
  const transport = custom({ async request({ method, params }) {
    calls.push({ method, params });
    if (method === "eth_chainId") return toHex(options.chainId);
    if (method === "eth_blockNumber") return toHex(options.head);
    if (method === "eth_getTransactionReceipt") return receipt;
    if (method === "eth_getBlockByNumber") return { hash: options.canonicalHash, number: "0x64", transactions: [] };
    if (method === "eth_call") {
      assert.equal(params[0].to.toLowerCase(), tokenAddress);
      const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: params[0].data });
      if (functionName === "symbol" && options.symbolFails) throw new Error("Token has no symbol");
      if (functionName === "balanceOf") assert.deepEqual(args, [senderAddress]);
      if (functionName === "allowance") assert.deepEqual(args, [senderAddress, treasuryAddress]);
      const values = { decimals: options.decimals, symbol: "USDT", balanceOf: options.value, allowance: 50000000000000000000n };
      assert.ok(functionName in values, `Unexpected function ${functionName}`);
      return encodeFunctionResult({ abi: erc20Abi, functionName, result: values[functionName] });
    }
    throw new Error(`Unexpected RPC method ${method}`);
  } }, { retryCount: 0 });
  return { reader: createEvmReader(config, transport), calls, receipt, log };
}

test("token and allowance reads use the configured chain, pin a block and serialize without bigint", async () => {
  const { reader, calls } = fixture();
  const token = await reader.readToken(senderAddress);
  assert.equal(token.balance, "12.345678");
  assert.equal(token.balanceUnits, "12345678000000000000");
  assert.equal(token.decimals, 18);
  assert.equal(token.symbol, "USDT");
  assert.equal((await reader.readAllowance(senderAddress, treasuryAddress)).allowanceUnits, "50000000000000000000");
  assert.doesNotThrow(() => JSON.stringify(token));
  assert.ok(calls.filter(call => call.method === "eth_call").every(call => call.params[1] === "0x69"));
  assert.equal((await fixture({ symbolFails: true }).reader.readToken(senderAddress)).symbol, null);
});

test("a confirmed, canonical token event returns precise review evidence and a chain-scoped reference", async () => {
  const { reader, calls } = fixture();
  const evidence = await reader.inspectTransfer(expectation);
  assert.equal(evidence.ledgerAmount, 12345678);
  assert.equal(evidence.confirmations, "6");
  assert.equal(evidence.settlementReference, `evm:137:${hash}:2`);
  assert.equal(evidence.tokenAmountUnits, "12345678000000000000");
  assert.doesNotThrow(() => JSON.stringify(evidence));
  assert.ok(calls.filter(call => call.method === "eth_call").every(call => call.params[1] === "0x64"));
});

test("transfer evidence also handles six-decimal token contracts", async () => {
  const { reader } = fixture({ decimals: 6, value: 12345678n });
  assert.equal((await reader.inspectTransfer(expectation)).ledgerAmount, 12345678);
});

test("transfer inspection rejects wrong chain, token, sender, receiver, amount, reorgs and insufficient confirmations", async () => {
  for (const [overrides, message] of [
    [{ chainId: 1 }, /chain ID/], [{ status: "0x0" }, /reverted/], [{ head: 104 }, /confirmations/],
    [{ head: 99 }, /confirmations/], [{ logAddress: otherAddress }, /No matching/],
    [{ from: otherAddress }, /sender or treasury/], [{ to: otherAddress }, /sender or treasury/],
    [{ value: 12345678000000000001n }, /amount does not match/], [{ canonicalHash: hash }, /canonical/],
    [{ removed: true }, /No matching/],
  ]) {
    await assert.rejects(fixture(overrides).reader.inspectTransfer(expectation), message);
  }
});

test("only the specified complete Transfer event can be used as evidence", async () => {
  const { reader, receipt, log } = fixture();
  receipt.logs.unshift({ ...log, address: otherAddress, logIndex: "0x0" });
  assert.equal((await reader.inspectTransfer(expectation)).logIndex, 2);
  await assert.rejects(reader.inspectTransfer({ ...expectation, logIndex: 0 }), /No matching/);
  log.data = "0x";
  await assert.rejects(reader.inspectTransfer(expectation), /No matching/);
});

test("invalid transfer expectations fail before any RPC request", async () => {
  const { reader, calls } = fixture();
  for (const changes of [{ hash: "invalid" }, { logIndex: -1 }, { logIndex: 0.5 }, { senderAddress: treasuryAddress },
    { amount: "0" }, { amount: "0.0000001" }, { amount: "9007199254.740992" }]) {
    await assert.rejects(reader.inspectTransfer({ ...expectation, ...changes }));
  }
  assert.equal(calls.length, 0);
});
