import type { H3Event } from "h3";
import type { AdminPayment, PlatformSettings } from "../../shared/admin";
import { db } from "./database";
import { randomUUID } from "./auth";
import { moneyScale } from "./wallet";

export function platformSettings(): PlatformSettings {
  const row = db().prepare("SELECT * FROM platform_settings WHERE id = 1").get() as { registration_open: number; funding_open: number; support_email: string };
  return { registrationOpen: !!row.registration_open, fundingOpen: !!row.funding_open, supportEmail: row.support_email };
}

export function audit(adminId: string, action: string, target: string) {
  db().prepare("INSERT INTO admin_audit VALUES (?, ?, ?, ?, ?)").run(randomUUID(), adminId, action, target, new Date().toISOString());
}

export function listQuery(event: H3Event) {
  const query = getQuery(event);
  const page = Math.max(1, Math.min(100000, Number.parseInt(String(query.page || "1"), 10) || 1));
  const search = String(query.search || "").trim().slice(0, 64);
  return { page, pageSize: 12, search, status: String(query.status || "all") };
}

export const paymentSelect = `SELECT t.id, u.username, w.id AS walletId, t.amount,
  CASE WHEN r.decision = 'rejected' THEN 'rejected' ELSE t.status END AS status,
  t.created_at AS createdAt, r.reference, r.note, a.username AS reviewedBy, r.created_at AS reviewedAt
  FROM wallet_transactions t JOIN wallets w ON w.id = t.wallet_id JOIN users u ON u.id = w.user_id
  LEFT JOIN payment_reviews r ON r.transaction_id = t.id LEFT JOIN users a ON a.id = r.admin_id`;

export function paymentRows(rows: unknown[]): AdminPayment[] {
  return (rows as AdminPayment[]).map(row => ({ ...row, amount: row.amount / moneyScale }));
}
