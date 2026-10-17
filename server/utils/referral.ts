import { randomBytes } from "node:crypto";
import type { ReferralProgram } from "../../shared/referral";
import { referralPrice } from "../../shared/referral";
import { db } from "./database";

export function activeSponsor(code: string) {
  return db().prepare(`SELECT u.id, u.username FROM users u
    JOIN referral_activations r ON r.user_id = u.id
    LEFT JOIN user_access a ON a.user_id = u.id
    WHERE u.referral_code = ? AND COALESCE(a.status, 'active') = 'active'`).get(code) as { id: string; username: string } | undefined;
}

export function newReferralCode() {
  let code: string;
  do { code = `LOOP-${randomBytes(4).toString("hex").toUpperCase()}`; }
  while (db().prepare("SELECT id FROM users WHERE referral_code = ?").get(code));
  return code;
}

export function referralProgram(userId: string): ReferralProgram {
  const row = db().prepare(`SELECT CASE WHEN r.user_id IS NOT NULL THEN u.referral_code END AS code,
    r.created_at AS activatedAt, r.transaction_id AS transactionId,
    s.username AS sponsorUsername, s.referral_code AS sponsorCode FROM users u
    LEFT JOIN referral_activations r ON r.user_id = u.id
    LEFT JOIN users s ON s.id = u.sponsor_id WHERE u.id = ?`).get(userId) as {
      code: string | null; activatedAt: string | null; transactionId: string | null;
      sponsorUsername: string | null; sponsorCode: string | null;
    };
  return { price: referralPrice, code: row.code, activatedAt: row.activatedAt, transactionId: row.transactionId,
    sponsor: row.sponsorUsername ? { username: row.sponsorUsername, code: row.sponsorCode! } : null };
}
