export const baseReferralPrice = 10;
export const maxReferralLevel = 15;
export const ledgerScale = 1_000_000;
export const directRates = [0.5, 0.2, 0.1] as const;
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
    ...[50, 20, 10].map((percent, index) => ({ kind: "direct" as const, depth: index + 1, units: units * percent / 100 })),
    ...Array.from({ length: maxReferralLevel }, (_, index) => ({ kind: "bonus" as const, depth: index + 1, units: units / 100 })),
    { kind: "platform", depth: 0, units: units * 5 / 100 },
  ];
}

// A short chain's unused trailing bonus shares belong to its highest eligible upline.
// Ineligible gaps still go to the platform; a chain with no eligible upline does too.
export function shareRecipientDepth(share: Pick<PurchaseShare, "kind" | "depth">, eligible: readonly boolean[]) {
  if (share.kind === "platform") return 0;
  let highest = 0;
  for (let index = 0; index < maxReferralLevel; index++) if (eligible[index]) highest = index + 1;
  const depth = share.kind === "bonus" && share.depth > highest ? highest : share.depth;
  return depth && eligible[depth - 1] ? depth : 0;
}
