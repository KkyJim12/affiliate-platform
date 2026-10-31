import { isMemberId } from "./referral-code.ts";

export interface ReferralPurchaseAccess {
  allowed: boolean;
  exempt: boolean;
  requiresSponsor: boolean;
}

// An empty value disables all exemptions. Never interpret wildcards, account
// UUIDs or wallet addresses as numeric member IDs.
export function referralExemptMemberIds(value: unknown = "1") {
  // Nuxt's environment loader decodes a single numeric setting as a number.
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Invalid referral purchase exemption member IDs.");
  const input = String(value);
  if (!input.trim()) return [];
  const ids = input.split(",").map(id => id.trim());
  if (ids.some(id => !isMemberId(id))) throw new Error("Invalid referral purchase exemption member IDs.");
  return [...new Set(ids)];
}
