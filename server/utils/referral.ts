import { randomBytes } from "node:crypto";
import type { ReferralProgram } from "../../shared/referral";
import { referralPrice } from "../../shared/referral";
import { ledgerScale, levelPrice, maxReferralLevel } from "../../shared/compensation";
import { isReferralCode, normalizeReferralCode } from "../../shared/referral-code";
import { db } from "./database";
export async function activeSponsor(code: string) {
    if (!isReferralCode(code)) return;
    code = normalizeReferralCode(code);
    return await db().one(`SELECT u.id, u.username FROM users u
    JOIN referral_activations r ON r.user_id = u.id
    LEFT JOIN user_access a ON a.user_id = u.id
    WHERE u.referral_code IN ($1, $2) AND COALESCE(a.status, 'active') = 'active'`, code, code.replace(/^UNXO-/, "LOOP-")) as {
        id: string;
        username: string;
    } | undefined;
}
export async function newReferralCode() {
    let code: string;
    do {
        code = `UNXO-${randomBytes(4).toString("hex").toUpperCase()}`;
    } while (await db().one("SELECT id FROM users WHERE referral_code IN ($1, $2)", code, code.replace(/^UNXO-/, "LOOP-")));
    return code;
}
export async function referralProgram(userId: string): Promise<ReferralProgram> {
    const row = await db().one(`SELECT CASE WHEN r.user_id IS NOT NULL THEN u.referral_code END AS code,
    r.created_at AS "activatedAt", COALESCE(r.transaction_id, cp.transaction_hash) AS "transactionId",
    s.username AS "sponsorUsername", s.referral_code AS "sponsorCode" FROM users u
    LEFT JOIN referral_activations r ON r.user_id = u.id
    LEFT JOIN referral_chain_purchases cp ON cp.id = r.chain_purchase_id
    LEFT JOIN users s ON s.id = u.sponsor_id WHERE u.id = $1`, userId) as {
        code: string | null;
        activatedAt: string | null;
        transactionId: string | null;
        sponsorUsername: string | null;
        sponsorCode: string | null;
    };
    const purchase = await db().one(`SELECT p.level, p.amount,
      COALESCE(SUM(CASE WHEN a.status = 'credited' THEN a.amount ELSE 0 END), 0) AS commissions,
      COALESCE(SUM(CASE WHEN a.status = 'payable' THEN a.amount ELSE 0 END), 0) AS payable
      FROM referral_purchases p LEFT JOIN referral_allocations a ON a.purchase_id = p.id
      WHERE p.user_id = $1 GROUP BY p.id ORDER BY p.level DESC LIMIT 1`, userId) as {
        level: number; amount: number; commissions: number; payable: number;
    } | undefined;
    const chain = await db().one("SELECT COALESCE(MAX(level), 0) AS level FROM referral_chain_purchases WHERE user_id = $1 AND status = 'confirmed'", userId);
    const level = Math.max(chain!.level, purchase?.level ?? (row.code ? 1 : 0));
    const settings = await db().one("SELECT fee_recipient_address FROM platform_settings WHERE id = 1") as { fee_recipient_address: string };
    return { price: referralPrice, code: row.code, activatedAt: row.activatedAt, transactionId: row.transactionId,
        currentLevel: level, maxLevel: maxReferralLevel, nextLevel: level < maxReferralLevel ? level + 1 : null,
        nextPrice: level < maxReferralLevel ? levelPrice(level + 1) : null, feeConfigured: !!settings.fee_recipient_address,
        latestPurchase: purchase ? { level: purchase.level, amount: purchase.amount / ledgerScale,
          commissions: purchase.commissions / ledgerScale, platformPayable: purchase.payable / ledgerScale } : null,
        sponsor: row.sponsorUsername ? { username: row.sponsorUsername, code: row.sponsorCode! } : null };
}
