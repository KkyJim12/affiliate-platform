import { formatUnits, isAddress, getAddress, maxUint256, parseUnits, zeroAddress } from "viem";
import type { Address } from "viem";

export const ledgerDecimals = 6;

function assertDecimals(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255)
    throw new Error("Token decimals must be an integer between 0 and 255.");
}

export function evmAddress(value: string): Address {
  if (!isAddress(value) || value.toLowerCase() === zeroAddress)
    throw new Error("Enter a valid, nonzero EVM address.");
  return getAddress(value);
}

// Viem can round excess fractional digits; money inputs must reject them instead.
export function parseTokenAmount(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (!/^\d+(\.\d+)?$/.test(value) || (value.split(".")[1]?.length ?? 0) > decimals)
    throw new Error("Enter a decimal amount within the token's precision.");
  const units = parseUnits(value, decimals);
  if (units > maxUint256) throw new Error("Token amount exceeds uint256.");
  return units;
}

export function tokenUnitsToLedger(units: bigint, decimals: number): number {
  assertDecimals(decimals);
  if (units < 0n || units > maxUint256) throw new Error("Invalid token amount.");
  const divisor = 10n ** BigInt(Math.max(0, decimals - ledgerDecimals));
  if (units % divisor !== 0n)
    throw new Error("Token amount cannot be represented exactly in the six-decimal ledger.");
  const ledgerUnits = units / divisor * 10n ** BigInt(Math.max(0, ledgerDecimals - decimals));
  if (ledgerUnits > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount exceeds the ledger's safe integer limit.");
  return Number(ledgerUnits);
}

export function ledgerUnitsToToken(units: number, decimals: number): bigint {
  if (!Number.isSafeInteger(units) || units < 0) throw new Error("Invalid ledger amount.");
  return parseTokenAmount(formatUnits(BigInt(units), ledgerDecimals), decimals);
}
