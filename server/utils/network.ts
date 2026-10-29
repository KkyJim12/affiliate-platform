import { getAddress } from "ethers";
import { polygonNetwork, polygonUsdtAddress } from "../../shared/evm-wallet";

export function appNetwork() {
  const config = useRuntimeConfig();
  const network = polygonNetwork(config.evm.chainId || config.public.chainId);
  if (network.chainId !== polygonNetwork(config.public.chainId).chainId)
    throw new Error("NUXT_EVM_CHAIN_ID and NUXT_PUBLIC_CHAIN_ID must match.");
  if (!network.testnet && getAddress(config.evm.tokenAddress || "") !== polygonUsdtAddress)
    throw new Error("Polygon mainnet requires the official Polygon USDT token address.");
  if (!network.testnet && config.referral.paymentMode !== "contract")
    throw new Error("Polygon mainnet requires contract payments.");
  return network;
}

export function walletEvmConfig() {
  const network=appNetwork();
  return {...useRuntimeConfig().evm,chainId:network.chainId,rpcUrl:useRuntimeConfig().evm.rpcUrl||network.rpcUrl};
}
