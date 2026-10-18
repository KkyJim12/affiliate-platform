import { accountFor, assertSameOrigin, findUser, rateLimit, requireUser } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { activeSponsor, referralProgram } from "../../utils/referral";
import { walletFor } from "../../utils/wallet";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    const user = await requireUser(event);
    await rateLimit(event, `referral-sponsor:${user.id}`, 15);
    const body = await readBody(event);
    const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
    await transaction(async () => {
        // Serialize graph changes so two concurrent links cannot form a cycle.
        await db().execute("SELECT pg_advisory_xact_lock(782438, 2)");
        const sponsor = /^LOOP-[A-Z0-9]{8}$/.test(code) ? await activeSponsor(code) : undefined;
        if (!sponsor)
            throw createError({ statusCode: 400, statusMessage: "That referral code is unavailable. Check the code with your sponsor." });
        if (sponsor.id === user.id)
            throw createError({ statusCode: 400, statusMessage: "You cannot use your own referral code." });
        const current = await db().one("SELECT sponsor_id FROM users WHERE id = $1", user.id) as {
            sponsor_id: string | null;
        };
        if (current.sponsor_id === sponsor.id)
            return;
        if (current.sponsor_id)
            throw createError({ statusCode: 409, statusMessage: "Your account is already linked to a sponsor." });
        if (await db().one("SELECT id FROM referral_chain_purchases WHERE user_id = $1 AND status = 'pending'", user.id))
            throw createError({ statusCode: 409, statusMessage: "Wait for your pending blockchain purchase to finish." });
        // Traverse every ancestor, including beyond the 15 levels displayed in the UI.
        const cycle = await db().one(`WITH RECURSIVE ancestors(id, sponsor_id) AS (
      SELECT id, sponsor_id FROM users WHERE id = $1
      UNION SELECT u.id, u.sponsor_id FROM users u JOIN ancestors a ON u.id = a.sponsor_id
    ) SELECT id FROM ancestors WHERE id = $2`, sponsor.id, user.id);
        if (cycle)
            throw createError({ statusCode: 400, statusMessage: "This referral would create a circular network. Choose another sponsor." });
        await db().execute("UPDATE users SET sponsor_id = $1 WHERE id = $2 AND sponsor_id IS NULL", sponsor.id, user.id);
    });
    return { user: await accountFor((await findUser(user.username))!), wallet: await walletFor(user.id), program: await referralProgram(user.id) };
});
