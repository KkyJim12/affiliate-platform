import { createError } from "h3";
import { referralExemptMemberIds, type ReferralPurchaseAccess } from "../../shared/referral-purchase-policy.ts";
import { db } from "./database.ts";

export async function referralPurchaseAccess(userId: string, database = db(), exemptIds: string = useRuntimeConfig().referral.sponsorExemptMemberIds): Promise<ReferralPurchaseAccess> {
  const member = await database.one<{ referral_code: string | null; sponsor_id: string | null }>(
    "SELECT referral_code,sponsor_id FROM users WHERE id=$1", userId);
  if (!member) throw createError({ statusCode: 404, statusMessage: "Member not found." });
  const exempt = referralExemptMemberIds(exemptIds).includes(member.referral_code ?? "");
  const allowed = !!member.sponsor_id || exempt;
  return { allowed, exempt, requiresSponsor: !allowed };
}

export async function assertReferralPurchaseAllowed(userId: string, database = db(), exemptIds: string = useRuntimeConfig().referral.sponsorExemptMemberIds) {
  const access = await referralPurchaseAccess(userId, database, exemptIds);
  if (!access.allowed) throw createError({ statusCode: 409,
    statusMessage: "Add a valid ref ID before purchasing a level.", data: { code: "REF_ID_REQUIRED" } });
  return access;
}
