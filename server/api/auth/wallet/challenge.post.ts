import { appNetwork } from "../../../utils/network";
import { randomBytes, randomUUID } from "node:crypto";
import { assertSameOrigin, rateLimit, requireUser } from "../../../utils/auth";
import { db } from "../../../utils/database";
import { requireExternalWalletMode, walletAuthOrigin } from "../../../utils/wallet-mode";
import { walletAddress, walletChallengeMessage } from "../../../lib/wallet-challenge";
import { normalizeReferralCode } from "../../../../shared/referral-code";

export default defineEventHandler(async event => {
  assertSameOrigin(event); requireExternalWalletMode();
  const origin = walletAuthOrigin(event);
  await rateLimit(event, "wallet-challenge", 50);
  const body = await readBody(event);
  let address: string;
  try { address = walletAddress(body?.address); } catch { throw createError({ statusCode: 400, statusMessage: "Connect a valid EVM wallet." }); }
  const purpose = body?.purpose === "link" ? "link" : "login";
  const user = purpose === "link" ? await requireUser(event) : null;
  if (user?.role === "admin" && user.referral_code !== "1")
    throw createError({ statusCode: 403, statusMessage: "Only administrator ID 1 can bind an admin wallet." });
  if (user?.role === "admin") {
    const existing = await db().one<{ address: string }>("SELECT address FROM connected_wallets WHERE user_id = $1", user.id);
    if (existing && existing.address.toLowerCase() !== address.toLowerCase())
      throw createError({ statusCode: 409, statusMessage: "This account already has a linked wallet. Use that wallet." });
  }
  const now = Date.now(), id = randomUUID();
  const message = walletChallengeMessage(origin, address, randomBytes(24).toString("hex"), now, purpose, appNetwork().chainId);
  const sponsor = normalizeReferralCode(typeof body?.sponsorCode === "string" ? body.sponsorCode.slice(0, 24) : "");
  await db().execute("DELETE FROM wallet_challenges WHERE expires_at < $1", now - 3600000);
  await db().execute(`INSERT INTO wallet_challenges (id,address,purpose,user_id,message,sponsor_code,expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, id, address, purpose, user?.id ?? null, message, sponsor, now + 300000);
  return { id, message };
});
