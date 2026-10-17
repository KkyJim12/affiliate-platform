import { randomBytes } from "node:crypto";
import type { ReferralProgram } from "../../shared/referral";
import { referralPrice } from "../../shared/referral";
import { db } from "./database";
export async function activeSponsor(code: string) {
    return await db().one(`SELECT u.id, u.username FROM users u
    JOIN referral_activations r ON r.user_id = u.id
    LEFT JOIN user_access a ON a.user_id = u.id
    WHERE u.referral_code = $1 AND COALESCE(a.status, 'active') = 'active'`, code) as {
        id: string;
        username: string;
    } | undefined;
}
export async function newReferralCode() {
    let code: string;
    do {
        code = `LOOP-${randomBytes(4).toString("hex").toUpperCase()}`;
    } while (await db().one("SELECT id FROM users WHERE referral_code = $1", code));
    return code;
}
export async function referralProgram(userId: string): Promise<ReferralProgram> {
    const row = await db().one(`SELECT CASE WHEN r.user_id IS NOT NULL THEN u.referral_code END AS code,
    r.created_at AS "activatedAt", r.transaction_id AS "transactionId",
    s.username AS "sponsorUsername", s.referral_code AS "sponsorCode" FROM users u
    LEFT JOIN referral_activations r ON r.user_id = u.id
    LEFT JOIN users s ON s.id = u.sponsor_id WHERE u.id = $1`, userId) as {
        code: string | null;
        activatedAt: string | null;
        transactionId: string | null;
        sponsorUsername: string | null;
        sponsorCode: string | null;
    };
    return { price: referralPrice, code: row.code, activatedAt: row.activatedAt, transactionId: row.transactionId,
        sponsor: row.sponsorUsername ? { username: row.sponsorUsername, code: row.sponsorCode! } : null };
}
