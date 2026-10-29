import { defineConfig } from "hardhat/config";

// Compilation uses the pinned local solc package, without downloading compilers.
export default defineConfig({
  paths: { cache: ".data/hardhat-cache", artifacts: ".data/hardhat-artifacts" },
  networks: { default: { type: "edr-simulated", chainId: 80002, hardfork: "cancun" }, polygon: { type: "edr-simulated", chainId: 137, hardfork: "cancun" } },
});
