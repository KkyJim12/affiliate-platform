import { polygonNetwork } from "#shared/evm-wallet";

export function usePolygonNetwork() {
  return polygonNetwork(useRuntimeConfig().public.chainId);
}
