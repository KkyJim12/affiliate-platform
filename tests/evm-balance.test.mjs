import assert from "node:assert/strict";
import test from "node:test";
import { custom, decodeFunctionData, encodeFunctionResult, erc20Abi } from "viem";
import { createWalletBalanceReader } from "../server/lib/evm-balance.ts";

const address = "0x3333333333333333333333333333333333333333";
const tokenAddress = "0x1111111111111111111111111111111111111111";
const config = { rpcUrl: "http://127.0.0.1:8545", chainId: "80002", tokenAddress };
function fixture(options = {}) {
  const calls = [];
  const transport = custom({ async request({ method, params }) {
    calls.push({ method, params });
    if (method === "eth_chainId") return options.wrongChain ? "0x89" : "0x13882";
    if (method === "eth_blockNumber") return "0x64";
    if (method === "eth_getBalance") {
      assert.deepEqual(params, [address, "0x64"]);
      return "0x2386f26fc10000"; // 0.01 POL
    }
    if (method === "eth_call") {
      assert.equal(params[0].to.toLowerCase(), tokenAddress);
      assert.equal(params[1], "0x64");
      const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: params[0].data });
      if (options.noDecimals && functionName === "decimals") throw new Error("Missing decimals");
      if (options.noSymbol && functionName === "symbol") throw new Error("Missing symbol");
      if (functionName === "balanceOf") assert.deepEqual(args, [address]);
      return encodeFunctionResult({ abi: erc20Abi, functionName, result: {
        decimals: 6, symbol: "USDT", balanceOf: 9007199254740993123456n,
      }[functionName] });
    }
    throw new Error(`Unexpected method ${method}`);
  } }, { retryCount: 0 });
  return { calls, read: createWalletBalanceReader({ ...config, ...options.config }, transport) };
}

test("wallet balances use the owner's address and a single block with exact JSON-safe amounts", async () => {
  const result = await fixture().read(address);
  assert.equal(result.chainId, 80002);
  assert.equal(result.blockNumber, "100");
  assert.equal(result.native.balance, "0.01");
  assert.equal(result.token.address, tokenAddress);
  assert.equal(result.token.balanceUnits, "9007199254740993123456");
  assert.equal(result.token.balance, "9007199254740993.123456");
  assert.equal(result.token.symbol, "USDT");
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("unconfigured tokens remain absent; unknown symbols never get labeled USDT", async () => {
  const { read, calls } = fixture({ config: { tokenAddress: "" } });
  assert.equal((await read(address)).token, null);
  assert.equal(calls.filter(call => call.method === "eth_call").length, 0);
  assert.equal((await fixture({ noSymbol: true }).read(address)).token.symbol, "ERC-20");
});

test("wrong networks and missing token precision fail rather than inventing zero balances", async () => {
  const wrong = fixture({ wrongChain: true });
  await assert.rejects(wrong.read(address), /network mismatch/);
  assert.equal(wrong.calls.length, 1);
  await assert.rejects(fixture({ noDecimals: true }).read(address), /Missing decimals/);
  await assert.rejects(fixture().read("LW-legacy-wallet"));
});

test("balance configuration rejects other chains, invalid addresses and RPC protocols", () => {
  for (const changes of [{ chainId: "1" }, { chainId: "invalid" }, { tokenAddress: "LW-id" }, { rpcUrl: "file:///secret" }])
    assert.throws(() => createWalletBalanceReader({ ...config, ...changes }));
  assert.doesNotThrow(() => createWalletBalanceReader({ rpcUrl: "", chainId: "", tokenAddress: "" }));
});
