import { accountFor, assertSameOrigin, createSession, hashPassword, randomUUID, rateLimit, type UserRow } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { platformSettings } from "../../utils/admin";
import { activeSponsor } from "../../utils/referral";
import { generateEncryptedEvmWallet } from "../../lib/evm-wallet";
import { insertEvmWallet } from "../../utils/evm-wallet";
import { requireEmbeddedWalletMode } from "../../utils/wallet-mode";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    requireEmbeddedWalletMode();
    await rateLimit(event, "register", 10);
    if (!(await platformSettings()).registrationOpen)
        throw createError({ statusCode: 403, statusMessage: "New registrations are temporarily paused." });
    const body = await readBody(event);
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const sponsorCode = typeof body?.sponsorCode === "string" ? body.sponsorCode.trim().toUpperCase() : "";
    if (!/^[a-z][a-z0-9_]{2,23}$/.test(username))
        throw createError({ statusCode: 400, statusMessage: "Use 3\u201324 letters, numbers, or underscores. Start with a letter." });
    if (password.length < 12 || password.length > 128)
        throw createError({ statusCode: 400, statusMessage: "Choose a password between 12 and 128 characters." });
    if (await db().one("SELECT id FROM users WHERE lower(username) = lower($1)", username))
        throw createError({ statusCode: 409, statusMessage: "That username is already taken." });
    const sponsor = sponsorCode ? await activeSponsor(sponsorCode) : undefined;
    if (sponsorCode && !sponsor)
        throw createError({ statusCode: 400, statusMessage: "That invite code was not found. Check it or leave it blank." });
    const user: UserRow = { id: randomUUID(), username, password_hash: await hashPassword(password), referral_code: `UNASSIGNED-${randomUUID()}`, sponsor_id: sponsor?.id || null, created_at: new Date().toISOString() };
    const evmWallet = await generateEncryptedEvmWallet(password);
    try {
        await transaction(async () => {
            if (sponsorCode && (await activeSponsor(sponsorCode))?.id !== sponsor?.id)
                throw createError({ statusCode: 400, statusMessage: "That invite code was not found. Check it or leave it blank." });
            await db().execute("INSERT INTO users VALUES ($1, $2, $3, $4, $5, $6)", user.id, user.username, user.password_hash, user.referral_code, user.sponsor_id, user.created_at);
            await db().execute("INSERT INTO wallets (id, user_id) VALUES ($1, $2)", `LW-${randomUUID()}`, user.id);
            await insertEvmWallet(user.id, evmWallet);
        });
    }
    catch (error) {
        if ((error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "users_username_unique")
            throw createError({ statusCode: 409, statusMessage: "That username is already taken." });
        throw error;
    }
    await createSession(event, user.id);
    setResponseStatus(event, 201);
    return { user: await accountFor(user) };
});
