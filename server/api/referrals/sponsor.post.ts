import { accountFor, assertSameOrigin, findUser, rateLimit, requireUser } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { activeSponsor, referralProgram } from "../../utils/referral";
import { walletFor } from "../../utils/wallet";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const user = requireUser(event);
  rateLimit(event, `referral-sponsor:${user.id}`, 15);
  const body = await readBody(event);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  transaction(() => {
    const sponsor = /^LOOP-[A-Z0-9]{8}$/.test(code) ? activeSponsor(code) : undefined;
    if (!sponsor) throw createError({ statusCode: 400, statusMessage: "That referral code is unavailable. Check the code with your sponsor." });
    if (sponsor.id === user.id) throw createError({ statusCode: 400, statusMessage: "You cannot use your own referral code." });
    const current = db().prepare("SELECT sponsor_id FROM users WHERE id = ?").get(user.id) as { sponsor_id: string | null };
    if (current.sponsor_id === sponsor.id) return;
    if (current.sponsor_id) throw createError({ statusCode: 409, statusMessage: "Your account is already linked to a sponsor." });
    // Traverse every ancestor, including beyond the 15 levels displayed in the UI.
    const cycle = db().prepare(`WITH RECURSIVE ancestors(id, sponsor_id) AS (
      SELECT id, sponsor_id FROM users WHERE id = ?
      UNION SELECT u.id, u.sponsor_id FROM users u JOIN ancestors a ON u.id = a.sponsor_id
    ) SELECT id FROM ancestors WHERE id = ?`).get(sponsor.id, user.id);
    if (cycle) throw createError({ statusCode: 400, statusMessage: "This referral would create a circular network. Choose another sponsor." });
    db().prepare("UPDATE users SET sponsor_id = ? WHERE id = ? AND sponsor_id IS NULL").run(sponsor.id, user.id);
  });
  return { user: accountFor(findUser(user.username)!), wallet: walletFor(user.id), program: referralProgram(user.id) };
});
