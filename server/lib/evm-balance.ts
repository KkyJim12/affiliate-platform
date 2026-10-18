import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import type { Transport } from "viem";
import { polygonAmoy } from "viem/chains";
import { evmAddress } from "../../shared/evm.ts";
import { polygonTestnet, type EvmWalletBalances } from "../../shared/evm-wallet.ts";

export function createWalletBalanceReader(input: { rpcUrl: string; chainId: string | number; tokenAddress: string }, transport?: Transport) {
  if (input.chainId !== "" && Number(input.chainId) !== polygonTestnet.chainId)
    throw new Error("Wallet balances require the account wallet's network.");
  const rpcUrl = input.rpcUrl || polygonTestnet.rpcUrl;
  if (!["http:", "https:"].includes(new URL(rpcUrl).protocol)) throw new Error("Invalid wallet RPC URL.");
  const tokenAddress = input.tokenAddress ? evmAddress(input.tokenAddress) : null;
  const client = createPublicClient({ chain: polygonAmoy, ccipRead: false,
    transport: transport ?? http(rpcUrl, { timeout: 8_000, retryCount: 0 }) });

  return async (address: string): Promise<EvmWalletBalances> => {
    const owner = evmAddress(address);
    if (await client.getChainId() !== polygonTestnet.chainId) throw new Error("Wallet RPC network mismatch.");
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const nativeUnits = await client.getBalance({ address: owner, blockNumber });
    const native = { symbol: polygonTestnet.currency, decimals: 18, balanceUnits: nativeUnits.toString(), balance: formatUnits(nativeUnits, 18) };
    let token: EvmWalletBalances["token"] = null;
    if (tokenAddress) {
      const [decimals, symbol, units] = await Promise.all([
        client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals", blockNumber }),
        client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol", blockNumber }).catch(() => "ERC-20"),
        client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [owner], blockNumber }),
      ]);
      token = { address: tokenAddress, decimals, symbol, balanceUnits: units.toString(), balance: formatUnits(units, decimals) };
    }
    return { address: owner, chainId: polygonTestnet.chainId, blockNumber: blockNumber.toString(), native, token };
  };
}
