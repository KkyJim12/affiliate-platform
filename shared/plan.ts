import { bonusRate, directRates, ledgerScale, levelPrice, purchaseShares } from "./compensation";
// Binary examples use the same depth rates as paid binary matrix commissions.
export const matrixRates = directRates;
export const rankPrice = levelPrice;
export const ranks = Array.from({ length: 15 }, (_, index) => {
  const rank = index + 1;
  const price = rankPrice(rank);
  return {
    rank,
    price,
    layers: matrixRates.map((rate, depth) => ({
      depth: depth + 1,
      positions: 2 ** (depth + 1),
      rate,
      gross: 2 ** (depth + 1) * price * rate,
    })),
    gross: matrixRates.reduce((sum, rate, index) => sum + 2 ** (index + 1) * price * rate, 0),
    firstCycle: price * 0.8,
    allocated: price * 0.2,
  };
});

export function unilevelProjection(rank: number) {
  const shares = purchaseShares(rank).filter(share => share.kind === "bonus");
  return Array.from({ length: 15 }, (_, index) => ({
    depth: index + 1,
    positions: 1,
    rate: bonusRate(index + 1),
    gross: shares[index]!.units / ledgerScale,
  }));
}

export const formatUsdt = (value: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
