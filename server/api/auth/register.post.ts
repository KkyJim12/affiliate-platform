import { accountFor, assertSameOrigin, createSession, hashPassword, randomUUID, rateLimit, type UserRow } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { platformSettings } from "../../utils/admin";
import { activeSponsor } from "../../utils/referral";
import { generateEncryptedEvmWallet } from "../../lib/evm-wallet";
import { insertEvmWallet } from "../../utils/evm-wallet";
import { requireEmbeddedWalletMode, requirePasswordLoginEnabled } from "../../utils/wallet-mode";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    requireEmbeddedWalletMode();
    requirePasswordLoginEnabled();
    await rateLimit(event, "register", 10);
    if (!(await platformSettings()).registrationOpen)
        throw createError({ statusCode: 403, statusMessage: "New registrations are temporarily paused." });
    const body = await readBody(event);
    const password = typeof body?.password === "string" ? body.password : "";
    const sponsorCode = typeof body?.sponsorCode === "string" ? body.sponsorCode.trim().toUpperCase() : "";
    if (password.length < 12 || password.length > 128)
        throw createError({ statusCode: 400, statusMessage: "Choose a password between 12 and 128 characters." });
    const sponsor = sponsorCode ? await activeSponsor(sponsorCode) : undefined;
    if (sponsorCode && !sponsor)
        throw createError({ statusCode: 400, statusMessage: "That invite code was not found. Check it or leave it blank." });
    // The retained database handle is private compatibility data, never a login or public identity.
    const user: UserRow = { id: randomUUID(), username: `account_${randomUUID()}`, password_hash: await hashPassword(password), referral_code: `UNASSIGNED-${randomUUID()}`, sponsor_id: sponsor?.id || null, created_at: new Date().toISOString() };
    const evmWallet = await generateEncryptedEvmWallet(password);
    await transaction(async () => {
            if (sponsorCode && (await activeSponsor(sponsorCode))?.id !== sponsor?.id)
                throw createError({ statusCode: 400, statusMessage: "That invite code was not found. Check it or leave it blank." });
            await db().execute("INSERT INTO users VALUES ($1, $2, $3, $4, $5, $6)", user.id, user.username, user.password_hash, user.referral_code, user.sponsor_id, user.created_at);
            await db().execute("INSERT INTO wallets (id, user_id) VALUES ($1, $2)", `LW-${randomUUID()}`, user.id);
            await insertEvmWallet(user.id, evmWallet);
    });
    await createSession(event, user.id);
    setResponseStatus(event, 201);
    return { user: await accountFor(user) };
});
