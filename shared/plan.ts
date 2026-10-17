// Reconstructed from the posters: 80% matrix + 15 x 1% unilevel + 5% system.
// These functions describe projections, not a payment or eligibility engine.
export const matrixRates = [0.1, 0.2, 0.5] as const;
export const unilevelRate = 0.01;
export const rankPrice = (rank: number) => 10 * 2 ** (rank - 1);
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
    gross: price * 5,
    firstCycle: price * 2,
    allocated: price * 3,
  };
});

export function unilevelProjection(rank: number) {
  return Array.from({ length: 15 }, (_, index) => ({
    depth: index + 1,
    positions: 2 ** (index + 1),
    rate: unilevelRate,
    gross: Math.round(2 ** (index + 1) * rankPrice(rank) * unilevelRate * 100) / 100,
  }));
}

export const formatUsdt = (value: number) =>
  value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
