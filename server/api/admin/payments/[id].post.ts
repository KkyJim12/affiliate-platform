import { assertSameOrigin, rateLimit, requireAdmin } from "../../../utils/auth";
import { db, transaction } from "../../../utils/database";
import { audit } from "../../../utils/admin";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const admin = requireAdmin(event);
  rateLimit(event, `admin-payments:${admin.id}`, 60);
  const id = getRouterParam(event, "id");
  const body = await readBody(event);
  const decision = body?.decision;
  const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!id || !["approved", "rejected"].includes(decision) || note.length > 500 || reference.length > 160) throw createError({ statusCode: 400, statusMessage: "Enter valid payment review details." });
  if (decision === "approved" && (reference.length < 6 || body?.verified !== true)) throw createError({ statusCode: 400, statusMessage: "Verify receipt of funds and enter a unique settlement reference." });
  if (decision === "rejected" && note.length < 3) throw createError({ statusCode: 400, statusMessage: "Enter a reason for rejecting this request." });
  transaction(() => {
    const payment = db().prepare("SELECT t.*, w.available, u.username FROM wallet_transactions t JOIN wallets w ON w.id = t.wallet_id JOIN users u ON u.id = w.user_id WHERE t.id = ? AND t.type = 'deposit'").get(id) as { amount: number; available: number; status: string; wallet_id: string; username: string } | undefined;
    if (!payment) throw createError({ statusCode: 404, statusMessage: "Payment request was not found." });
    const review = db().prepare("SELECT decision, reference, note FROM payment_reviews WHERE transaction_id = ?").get(id) as { decision: string; reference: string | null; note: string } | undefined;
    if (review) {
      if (review.decision === decision && review.reference === (decision === "approved" ? reference : null) && review.note === note) return;
      throw createError({ statusCode: 409, statusMessage: "This payment has already been reviewed." });
    }
    if (payment.status !== "pending") throw createError({ statusCode: 409, statusMessage: "This payment has already been reviewed." });
    if (decision === "approved") {
      if (db().prepare("SELECT transaction_id FROM payment_reviews WHERE reference = ?").get(reference)) throw createError({ statusCode: 409, statusMessage: "This settlement reference has already been used." });
      if (!Number.isSafeInteger(payment.available + payment.amount)) throw createError({ statusCode: 409, statusMessage: "The recipient wallet cannot accept this amount." });
      db().prepare("UPDATE wallets SET available = available + ? WHERE id = ?").run(payment.amount, payment.wallet_id);
      db().prepare("UPDATE wallet_transactions SET status = 'completed' WHERE id = ?").run(id);
    }
    db().prepare("INSERT INTO payment_reviews VALUES (?, ?, ?, ?, ?, ?)").run(id, decision, decision === "approved" ? reference : null, note, admin.id, new Date().toISOString());
    audit(admin.id, decision === "approved" ? "payment_approved" : "payment_rejected", payment.username);
  });
  return { ok: true };
});
