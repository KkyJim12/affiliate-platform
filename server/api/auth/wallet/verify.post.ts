import { appNetwork } from "../../../utils/network";
import { randomBytes, randomUUID } from "node:crypto";
import { accountFor, assertSameOrigin, createSession, currentUser, hashPassword, rateLimit, type UserRow } from "../../../utils/auth";
import { db, transaction } from "../../../utils/database";
import { platformSettings } from "../../../utils/admin";
import { activeSponsor } from "../../../utils/referral";
import { requireExternalWalletMode, walletAuthOrigin } from "../../../utils/wallet-mode";
import { verifyWalletChallenge } from "../../../lib/wallet-challenge";

export default defineEventHandler(async event => {
  assertSameOrigin(event); requireExternalWalletMode();
  const origin = walletAuthOrigin(event);
  await rateLimit(event, "wallet-verify", 40);
  const body = await readBody(event), session = await currentUser(event);
  if (typeof body?.id !== "string" || body.id.length > 64) throw createError({ statusCode: 400, statusMessage: "Request a new wallet sign-in message." });
  const invalid = () => createError({ statusCode: 401, statusMessage: "Wallet signature is invalid or expired. Request a new message." });
  // Hash outside the transaction; new wallet accounts have no usable password.
  const unusablePassword = await hashPassword(randomBytes(32).toString("hex"));
  const user = await transaction(async () => {
    const challenge = await db().one("SELECT * FROM wallet_challenges WHERE id = $1 FOR UPDATE", body.id);
    if (!challenge || challenge.consumed_at || Number(challenge.expires_at) < Date.now()
      || !challenge.message.includes(`\nURI: ${origin}\n`) || !challenge.message.includes(`\nChain ID: ${appNetwork().chainId}\n`)
      || !verifyWalletChallenge(challenge.message, challenge.address, body.signature)) throw invalid();
    await db().execute("SELECT pg_advisory_xact_lock(782438, 3)");
    let owner = await db().one<UserRow>(`SELECT u.*, COALESCE(a.role,'member') AS role, COALESCE(a.status,'active') AS status
      FROM connected_wallets w JOIN users u ON u.id = w.user_id LEFT JOIN user_access a ON a.user_id = u.id WHERE lower(w.address) = lower($1)`, challenge.address);
    if (challenge.purpose === "link") {
      if (!session || session.id !== challenge.user_id) throw invalid();
      if (owner && owner.id !== session.id) throw createError({ statusCode: 409, statusMessage: "This wallet is already linked to another account." });
      const existing = await db().one("SELECT address FROM connected_wallets WHERE user_id = $1", session.id);
      if (existing && existing.address.toLowerCase() !== challenge.address.toLowerCase())
        throw createError({ statusCode: 409, statusMessage: "This account already has a linked wallet. Use that wallet." });
      owner = session;
    } else if (!owner) {
      if (!(await platformSettings()).registrationOpen) throw createError({ statusCode: 403, statusMessage: "New registrations are temporarily paused." });
      const sponsor = challenge.sponsor_code ? await activeSponsor(challenge.sponsor_code) : undefined;
      if (challenge.sponsor_code && !sponsor) throw createError({ statusCode: 400, statusMessage: "That invite code was not found. Check it or leave it blank." });
      owner = { id: randomUUID(), username: `w_${randomBytes(9).toString("hex")}`, password_hash: unusablePassword,
        referral_code: null, sponsor_id: sponsor?.id ?? null, created_at: new Date().toISOString(), role: "member" };
      await db().execute("INSERT INTO users (id,username,password_hash,referral_code,sponsor_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        owner.id, owner.username, owner.password_hash, owner.referral_code, owner.sponsor_id, owner.created_at);
      await db().execute("INSERT INTO wallets (id,user_id) VALUES ($1,$2)", `LW-${randomUUID()}`, owner.id);
    }
    if (owner.role === "admin" && challenge.purpose !== "link")
      throw createError({ statusCode: 403, statusMessage: "Sign in to admin with your member ID and password." });
    if (owner.status === "suspended") throw createError({ statusCode: 403, statusMessage: "This account is suspended." });
    await db().execute("INSERT INTO connected_wallets (user_id,address,created_at,chain_id) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO NOTHING", owner.id, challenge.address, new Date().toISOString(),appNetwork().chainId);
    await db().execute("UPDATE wallet_challenges SET consumed_at = $1 WHERE id = $2", Date.now(), body.id);
    return owner;
  });
  await createSession(event, user.id);
  return { user: await accountFor(user) };
});
