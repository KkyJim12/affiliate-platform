import { assertSameOrigin, rateLimit, requireAdmin } from "../../../utils/auth";
import { db, transaction } from "../../../utils/database";
import { audit } from "../../../utils/admin";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    const admin = await requireAdmin(event);
    await rateLimit(event, `admin-payments:${admin.id}`, 60);
    const id = getRouterParam(event, "id");
    const body = await readBody(event);
    const decision = body?.decision;
    const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!id || !["approved", "rejected"].includes(decision) || note.length > 500 || reference.length > 160)
        throw createError({ statusCode: 400, statusMessage: "Enter valid payment review details." });
    if (decision === "approved" && (reference.length < 6 || body?.verified !== true))
        throw createError({ statusCode: 400, statusMessage: "Verify receipt of funds and enter a unique settlement reference." });
    if (decision === "rejected" && note.length < 3)
        throw createError({ statusCode: 400, statusMessage: "Enter a reason for rejecting this request." });
    try { await transaction(async () => {
        const payment = await db().one("SELECT t.*, w.available, u.username FROM wallet_transactions t JOIN wallets w ON w.id = t.wallet_id JOIN users u ON u.id = w.user_id WHERE t.id = $1 AND t.type = 'deposit' FOR UPDATE OF t, w", id) as {
            amount: number;
            available: number;
            status: string;
            wallet_id: string;
            username: string;
        } | undefined;
        if (!payment)
            throw createError({ statusCode: 404, statusMessage: "Payment request was not found." });
        const review = await db().one("SELECT decision, reference, note FROM payment_reviews WHERE transaction_id = $1", id) as {
            decision: string;
            reference: string | null;
            note: string;
        } | undefined;
        if (review) {
            if (review.decision === decision && review.reference === (decision === "approved" ? reference : null) && review.note === note)
                return;
            throw createError({ statusCode: 409, statusMessage: "This payment has already been reviewed." });
        }
        if (payment.status !== "pending")
            throw createError({ statusCode: 409, statusMessage: "This payment has already been reviewed." });
        if (decision === "approved") {
            if (await db().one("SELECT transaction_id FROM payment_reviews WHERE lower(reference) = lower($1)", reference))
                throw createError({ statusCode: 409, statusMessage: "This settlement reference has already been used." });
            if (!Number.isSafeInteger(payment.available + payment.amount))
                throw createError({ statusCode: 409, statusMessage: "The recipient wallet cannot accept this amount." });
            await db().execute("UPDATE wallets SET available = available + $1 WHERE id = $2", payment.amount, payment.wallet_id);
            await db().execute("UPDATE wallet_transactions SET status = 'completed' WHERE id = $1", id);
        }
        await db().execute("INSERT INTO payment_reviews VALUES ($1, $2, $3, $4, $5, $6)", id, decision, decision === "approved" ? reference : null, note, admin.id, new Date().toISOString());
        await audit(admin.id, decision === "approved" ? "payment_approved" : "payment_rejected", payment.username);
    }); } catch (error) {
        if ((error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "payment_reviews_reference_unique")
            throw createError({ statusCode: 409, statusMessage: "This settlement reference has already been used." });
        throw error;
    }
    return { ok: true };
});
