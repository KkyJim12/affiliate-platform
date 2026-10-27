import type { WalletSummary, WalletTransaction } from "../../shared/types";
import { db } from "./database";
export const moneyScale = 1000000;
// Preserve historical rows while exposing member IDs in older transfer descriptions.
export const ledgerDescriptionSql = `CASE WHEN t.description ~ '^Transfer (to|from) @' THEN
  regexp_replace(t.description, ' @.*$', ' ID ' || COALESCE((SELECT legacy.referral_code FROM users legacy
    WHERE lower(legacy.username) = lower(substring(t.description from '^Transfer (?:to|from) @(.+)$'))), '---'))
  ELSE t.description END`;

export interface WalletRow {
    id: string;
    user_id: string;
    available: number;
    reserved: number;
}
export async function walletRow(userId: string, lock = false) {
    const row = await db().one(`SELECT * FROM wallets WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`, userId) as WalletRow | undefined;
    if (!row)
        throw createError({ statusCode: 500, statusMessage: "Your wallet is unavailable. Please contact support." });
    return row;
}
export function parseAmount(value: unknown) {
    if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,6})?$/.test(value))
        throw createError({ statusCode: 400, statusMessage: "Enter an amount with up to 6 decimal places." });
    const amount = Math.round(Number(value) * moneyScale);
    if (!Number.isSafeInteger(amount) || amount < 10000 || amount > 999999999 * moneyScale)
        throw createError({ statusCode: 400, statusMessage: "Enter an amount between 0.01 and 999,999,999 USDT." });
    return amount;
}
export function parseRequestKey(value: unknown) {
    if (typeof value !== "string" || !/^[a-f0-9-]{36}$/i.test(value))
        throw createError({ statusCode: 400, statusMessage: "Invalid request. Please try again." });
    return value;
}
export async function walletFor(userId: string): Promise<WalletSummary> {
    const wallet = await walletRow(userId);
    const rows = await db().all(`SELECT t.id, t.type, t.amount, t.created_at, ${ledgerDescriptionSql} AS description, CASE WHEN r.decision = 'rejected' THEN 'rejected' ELSE t.status END AS display_status FROM wallet_transactions t LEFT JOIN payment_reviews r ON r.transaction_id = t.id WHERE t.wallet_id = $1 ORDER BY t.created_at DESC, t.sequence DESC LIMIT 200`, wallet.id) as {
        id: string;
        type: WalletTransaction["type"];
        amount: number;
        display_status: WalletTransaction["status"];
        description: string;
        created_at: string;
    }[];
    const earned = await db().one("SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_transactions WHERE wallet_id = $1 AND type = 'commission' AND status = 'completed'", wallet.id) as {
        total: number;
    };
    return {
        id: wallet.id, currency: "USDT", available: wallet.available / moneyScale, reserved: wallet.reserved / moneyScale, earned: earned.total / moneyScale,
        transactions: rows.map((row) => ({ id: row.id, type: row.type, amount: row.amount / moneyScale, status: row.display_status, description: row.description, createdAt: row.created_at })),
    };
}
