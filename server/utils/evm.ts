import { createEvmReader } from "../lib/evm";

export function evmReader() {
  return createEvmReader(useRuntimeConfig().evm);
}
