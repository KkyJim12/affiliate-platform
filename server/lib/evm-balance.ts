import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import type { Transport } from "viem";
import { polygonAmoy, polygon } from "viem/chains";
import { evmAddress } from "../../shared/evm.ts";
import { polygonNetwork, type EvmWalletBalances } from "../../shared/evm-wallet.ts";

export function createWalletBalanceReader(input: { rpcUrl: string; chainId: string | number; tokenAddress: string }, transport?: Transport) {
  const network = polygonNetwork(input.chainId);
  const rpcUrl = input.rpcUrl || network.rpcUrl;
  if (!["http:", "https:"].includes(new URL(rpcUrl).protocol)) throw new Error("Invalid wallet RPC URL.");
  const tokenAddress = input.tokenAddress ? evmAddress(input.tokenAddress) : null;
  const client = createPublicClient({ chain: network.testnet ? polygonAmoy : polygon, ccipRead: false,
    transport: transport ?? http(rpcUrl, { timeout: 8_000, retryCount: 0 }) });

  return async (address: string): Promise<EvmWalletBalances> => {
    const owner = evmAddress(address);
    if (await client.getChainId() !== network.chainId) throw new Error("Wallet RPC network mismatch.");
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const nativeUnits = await client.getBalance({ address: owner, blockNumber });
    const native = { symbol: network.currency, decimals: 18, balanceUnits: nativeUnits.toString(), balance: formatUnits(nativeUnits, 18) };
    let token: EvmWalletBalances["token"] = null;
    if (tokenAddress) {
      const [decimals, symbol, units] = await Promise.all([
        client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals", blockNumber }),
        client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol", blockNumber }).catch(() => "ERC-20"),
        client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [owner], blockNumber }),
      ]);
      token = { address: tokenAddress, decimals, symbol, balanceUnits: units.toString(), balance: formatUnits(units, decimals) };
    }
    return { address: owner, chainId: network.chainId, blockNumber: blockNumber.toString(), native, token };
  };
}
