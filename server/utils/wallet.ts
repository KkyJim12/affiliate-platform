import type { WalletSummary, WalletTransaction } from "../../shared/types";
import { db } from "./database";

export const moneyScale = 1_000_000;
export interface WalletRow { id: string; user_id: string; available: number; reserved: number }

export function walletRow(userId: string) {
  const row = db().prepare("SELECT * FROM wallets WHERE user_id = ?").get(userId) as WalletRow | undefined;
  if (!row) throw createError({ statusCode: 500, statusMessage: "Your wallet is unavailable. Please contact support." });
  return row;
}

export function parseAmount(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,6})?$/.test(value)) throw createError({ statusCode: 400, statusMessage: "Enter an amount with up to 6 decimal places." });
  const amount = Math.round(Number(value) * moneyScale);
  if (!Number.isSafeInteger(amount) || amount < 10_000 || amount > 999_999_999 * moneyScale) throw createError({ statusCode: 400, statusMessage: "Enter an amount between 0.01 and 999,999,999 USDT." });
  return amount;
}

export function parseRequestKey(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9-]{36}$/i.test(value)) throw createError({ statusCode: 400, statusMessage: "Invalid request. Please try again." });
  return value;
}

export function walletFor(userId: string): WalletSummary {
  const wallet = walletRow(userId);
  const rows = db().prepare(`SELECT t.*, CASE WHEN r.decision = 'rejected' THEN 'rejected' ELSE t.status END AS display_status FROM wallet_transactions t LEFT JOIN payment_reviews r ON r.transaction_id = t.id WHERE t.wallet_id = ? ORDER BY t.created_at DESC, t.rowid DESC LIMIT 200`).all(wallet.id) as { id: string; type: WalletTransaction["type"]; amount: number; display_status: WalletTransaction["status"]; description: string; created_at: string }[];
  const earned = db().prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions WHERE wallet_id = ? AND type = 'commission' AND status = 'completed'").get(wallet.id) as { total: number };
  return {
    id: wallet.id, currency: "USDT", available: wallet.available / moneyScale, reserved: wallet.reserved / moneyScale, earned: earned.total / moneyScale,
    transactions: rows.map((row) => ({ id: row.id, type: row.type, amount: row.amount / moneyScale, status: row.display_status, description: row.description, createdAt: row.created_at })),
  };
}
