export const baseReferralPrice = 10;
export const maxReferralLevel = 15;
export const ledgerScale = 1_000_000;
export const directRates = [0.5, 0.2, 0.1] as const;
export const bonusPoolRate = 0.15;
export const platformFeeRate = 0.05;
const bonusWeightTotal = 2 ** maxReferralLevel - 1;

export function levelPrice(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > maxReferralLevel)
    throw new RangeError("Referral level must be between 1 and 15.");
  return baseReferralPrice * 2 ** (level - 1);
}

export const bonusRate = (depth: number) => {
  if (!Number.isInteger(depth) || depth < 1 || depth > maxReferralLevel)
    throw new RangeError("Referral depth must be between 1 and 15.");
  return bonusPoolRate * 2 ** (maxReferralLevel - depth) / bonusWeightTotal;
};

export interface PurchaseShare {
  kind: "direct" | "bonus" | "platform";
  depth: number;
  units: number;
}

// Largest-remainder rounding keeps the 15% pool exact at six decimal places.
// BigInt avoids precision loss when multiplying level-15 amounts by weights.
export function purchaseShares(level: number): PurchaseShare[] {
  const units = levelPrice(level) * ledgerScale;
  const pool = BigInt(units) * 15n / 100n;
  const denominator = BigInt(bonusWeightTotal);
  const bonus = Array.from({ length: maxReferralLevel }, (_, index) => {
    const numerator = pool * BigInt(2 ** (maxReferralLevel - index - 1));
    return { kind: "bonus" as const, depth: index + 1, units: Number(numerator / denominator), remainder: numerator % denominator };
  });
  const remaining = Number(pool) - bonus.reduce((sum, share) => sum + share.units, 0);
  const order = [...bonus].sort((a, b) => a.remainder === b.remainder ? a.depth - b.depth : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remaining; index++) order[index]!.units++;
  return [
    ...[50, 20, 10].map((percent, index) => ({ kind: "direct" as const, depth: index + 1, units: units * percent / 100 })),
    ...bonus.map(({ kind, depth, units }) => ({ kind, depth, units })),
    { kind: "platform", depth: 0, units: units * 5 / 100 },
  ];
}
