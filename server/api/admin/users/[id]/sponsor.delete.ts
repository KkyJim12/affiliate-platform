import { assertSameOrigin, rateLimit, requireAdmin } from "../../../../utils/auth";
import { db, transaction } from "../../../../utils/database";
import { adminReferralPurchaseFields, audit } from "../../../../utils/admin";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const admin = await requireAdmin(event);
  await rateLimit(event, `admin-referral-cancellation:${admin.id}`, 60);
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "That member ID was not found." });

  await transaction(async () => {
    // Serialize with sponsor links, ledger purchases, and signed chain quotes.
    await db().execute("SELECT pg_advisory_xact_lock(782438, 2)");
    const user = await db().one<{ sponsor_id: string | null; hasPurchased: boolean; hasPendingPurchase: boolean }>(
      `SELECT u.sponsor_id, ${adminReferralPurchaseFields} FROM users u WHERE u.id = $1 FOR UPDATE OF u`, id);
    if (!user) throw createError({ statusCode: 404, statusMessage: "That member ID was not found." });
    if (user.hasPurchased) throw createError({ statusCode: 409, statusMessage: "The ref ID cannot be cancelled after a purchase." });
    if (user.hasPendingPurchase) throw createError({ statusCode: 409, statusMessage: "Wait for the pending blockchain purchase to finish before cancelling the ref ID." });
    if (!user.sponsor_id) return;

    await db().execute("UPDATE users SET sponsor_id = NULL WHERE id = $1", id);
    // Release this unpaid account's old placement so a new sponsor takes effect.
    // Keep slot records and their descendants intact.
    await db().execute("DELETE FROM referral_placements WHERE user_id = $1", id);
    await db().execute("UPDATE matrix_slots SET parent_id = NULL, branch = NULL, placement_reserved = FALSE WHERE user_id = $1 AND NOT unlocked", id);
    await db().execute("UPDATE unilevel_slots SET parent_id = NULL, branch = NULL, placement_reserved = FALSE WHERE user_id = $1 AND NOT unlocked", id);
    await audit(admin.id, "user_referral_cancelled", id);
  });
  return { ok: true };
});
