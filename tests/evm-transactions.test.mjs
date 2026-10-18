import assert from "node:assert/strict";
import test from "node:test";
import { maxUint256, zeroAddress } from "viem";
import { createWalletHistoryReader } from "../server/lib/evm-transactions.ts";
import { resolveEvmConfig } from "../server/lib/evm.ts";

const owner = "0x3333333333333333333333333333333333333333";
const other = "0x4444444444444444444444444444444444444444";
const tokenAddress = "0x1111111111111111111111111111111111111111";
const config = { explorerApiKey: "offline-test-key", chainId: "80002", tokenAddress };
const hash = n => `0x${n.toString(16).padStart(64, "0")}`;
function row(changes = {}) {
  return { hash: hash(1), from: other, to: owner, value: "12500000000000000000", timeStamp: "1792378800",
    blockNumber: "100", transactionIndex: "1", input: "0x", isError: "0", txreceipt_status: "1", ...changes };
}
function token(changes = {}) {
  return row({ hash: hash(2), contractAddress: tokenAddress, tokenDecimal: "6", tokenSymbol: "USDT", value: "9007199254740993123456", ...changes });
}
function fixture(options = {}) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    const native = url.searchParams.get("action") === "txlist";
    const result = native ? options.native ?? [row()] : options.token ?? [token()];
    return Response.json(options.payload ?? { status: "1", message: "OK", result }, { status: options.httpStatus ?? 200 });
  };
  return { calls, read: createWalletHistoryReader({ ...config, ...options.config }, request) };
}

test("history pins Amoy/owner/token queries and preserves precise amounts without leaking provider fields", async () => {
  const { read, calls } = fixture({ native: [row({ secret: "never expose" })], token: [token({ from: zeroAddress })] });
  const result = await read(owner);
  assert.equal(result.chainId, 80002);
  assert.equal(result.address, owner);
  assert.equal(result.transactions.find(item => item.kind === "native").amount, "12.5");
  const transfer = result.transactions.find(item => item.kind === "erc20");
  assert.equal(transfer.amount, "9007199254740993.123456");
  assert.equal(transfer.from, zeroAddress);
  assert.equal(transfer.direction, "received");
  assert.equal(transfer.symbol, "USDT");
  assert.equal(transfer.explorerUrl, `https://amoy.polygonscan.com/tx/${hash(2)}`);
  for (const { url, init } of calls) {
    assert.equal(url.origin + url.pathname, "https://api.etherscan.io/v2/api");
    assert.equal(url.searchParams.get("chainid"), "80002");
    assert.equal(url.searchParams.get("address"), owner);
    assert.equal(url.searchParams.get("offset"), "50");
    assert.equal(url.searchParams.get("sort"), "desc");
    assert.equal(url.searchParams.get("apikey"), config.explorerApiKey);
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    if (url.searchParams.get("action") === "tokentx") assert.equal(url.searchParams.get("contractaddress"), tokenAddress);
  }
  assert.ok(!JSON.stringify(result).includes(config.explorerApiKey));
  assert.ok(!JSON.stringify(result).includes("never expose"));
});

test("history distinguishes failed sends, self transfers, contract calls and contract creation", async () => {
  const result = await fixture({ token: [], native: [
    row({ from: owner, to: other, isError: "1", txreceipt_status: "0" }),
    row({ hash: hash(2), from: owner, to: owner }),
    row({ hash: hash(3), from: owner, to: other, value: "0", input: "0x1234" }),
    row({ hash: hash(4), from: owner, to: "", value: "0" }),
  ] }).read(owner);
  assert.equal(result.transactions[0].status, "failed");
  assert.equal(result.transactions[0].direction, "sent");
  assert.equal(result.transactions[1].direction, "self");
  assert.equal(result.transactions[2].action, "contractCall");
  assert.equal(result.transactions[3].action, "contractCreation");
  assert.equal(result.transactions[3].to, null);
});

test("latest records merge by block/index, cap at 50, and retain separate token events sharing one hash", async () => {
  const native = Array.from({ length: 50 }, (_, i) => row({ hash: hash(i + 10), blockNumber: String(100 - i), transactionIndex: "1" }));
  const tokens = Array.from({ length: 50 }, (_, i) => token({ blockNumber: String(100 - i), transactionIndex: "2" }));
  const result = await fixture({ native, token: tokens }).read(owner);
  assert.equal(result.transactions.length, 50);
  assert.deepEqual(result.transactions.slice(0, 4).map(item => item.kind), ["erc20", "native", "erc20", "native"]);
  assert.equal(new Set(result.transactions.map(item => item.id)).size, 50);
  assert.equal(result.transactions.filter(item => item.kind === "erc20").length, 25);
});

test("only explicit no-record responses are empty; provider errors and partial failures reject the read", async () => {
  for (const payload of [{ status: "0", message: "No transactions found", result: [] }, { status: "1", message: "OK", result: [] }])
    assert.deepEqual((await fixture({ payload }).read(owner)).transactions, []);
  for (const options of [
    { httpStatus: 503 }, { payload: { status: "0", message: "NOTOK", result: "Max rate limit reached" } },
    { payload: { status: "0", message: "NOTOK", result: [] } }, { payload: { status: "1", result: "invalid" } },
    { payload: { status: "0", message: "No transactions found", result: "Invalid API key" } },
    { token: [token({ tokenDecimal: "" })] }, { native: Array.from({ length: 51 }, () => row()) },
  ]) await assert.rejects(fixture(options).read(owner));
});

test("unrelated wallets, invalid token contracts, hashes, precision, amounts and status cannot become history records", async () => {
  for (const options of [
    { native: [row({ from: other, to: tokenAddress })] }, { native: [row({ hash: "javascript:alert(1)" })] },
    { native: [row({ to: "LW-internal" })] }, { native: [row({ value: "-1" })] },
    { native: [row({ value: String(maxUint256 + 1n) })] }, { native: [row({ isError: 1 })] },
    { native: [row({ txreceipt_status: "" })] }, { token: [token({ tokenDecimal: "256" })] },
    { token: [token({ tokenSymbol: "USDT\n" })] }, { token: [token({ contractAddress: other })] },
  ]) await assert.rejects(fixture(options).read(owner));
  await assert.rejects(fixture().read("LW-not-an-evm-address"));
});

test("history configuration is independent of RPC/settlement settings and supports unfiltered ERC-20 history", async () => {
  for (const changes of [{ explorerApiKey: "" }, { chainId: "137" }, { tokenAddress: zeroAddress }])
    assert.throws(() => createWalletHistoryReader({ ...config, ...changes }));
  const { read, calls } = fixture({ config: { chainId: "", tokenAddress: "" } });
  await read(owner);
  assert.ok(calls.every(call => !call.url.searchParams.has("contractaddress")));
  assert.equal(resolveEvmConfig({ rpcUrl: "", chainId: "", tokenAddress: "", treasuryAddress: "", minConfirmations: "", explorerApiKey: config.explorerApiKey }), null);
});
