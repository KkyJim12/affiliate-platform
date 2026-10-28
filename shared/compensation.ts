export const baseReferralPrice = 10;
export const maxReferralLevel = 15;
export const ledgerScale = 1_000_000;
export const directRates = [0.1, 0.2, 0.5] as const;
export const bonusPoolRate = 0.15;
export const platformFeeRate = 0.05;

export function levelPrice(level: number) {
  if (!Number.isInteger(level) || level < 1 || level > maxReferralLevel)
    throw new RangeError("Referral level must be between 1 and 15.");
  return baseReferralPrice * 2 ** (level - 1);
}

export const bonusRate = (depth: number) => {
  if (!Number.isInteger(depth) || depth < 1 || depth > maxReferralLevel)
    throw new RangeError("Referral depth must be between 1 and 15.");
  return 0.01;
};

export interface PurchaseShare {
  kind: "direct" | "bonus" | "platform";
  depth: number;
  units: number;
}

// All prices are divisible by 100 at ledger precision: every bonus is exactly 1%.
export function purchaseShares(level: number): PurchaseShare[] {
  const units = levelPrice(level) * ledgerScale;
  return [
    ...[10, 20, 50].map((percent, index) => ({ kind: "direct" as const, depth: index + 1, units: units * percent / 100 })),
    ...Array.from({ length: maxReferralLevel }, (_, index) => ({ kind: "bonus" as const, depth: index + 1, units: units / 100 })),
    { kind: "platform", depth: 0, units: units * 5 / 100 },
  ];
}

// Every share stays at its stated depth. Missing or locked slots pay the platform.
export function shareRecipientDepth(share: Pick<PurchaseShare, "kind" | "depth">, eligible: readonly boolean[]) {
  if (share.kind === "platform") return 0;
  return eligible[share.depth - 1] ? share.depth : 0;
}

export const shareRecipientIndex = (share: Pick<PurchaseShare, "kind" | "depth">) =>
  share.kind === "platform" ? -1 : (share.kind === "bonus" ? 3 : 0) + share.depth - 1;

export function remainingLevelPrice(level: number) {
  levelPrice(level);
  return Array.from({ length: maxReferralLevel - level + 1 }, (_, index) => levelPrice(level + index)).reduce((sum, price) => sum + price, 0);
}
