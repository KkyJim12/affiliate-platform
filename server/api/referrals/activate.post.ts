import { referralPrice } from "../../../shared/referral";
import { accountFor, assertSameOrigin, findUser, randomUUID, rateLimit, requireUser, verifyPassword } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { newReferralCode, referralProgram } from "../../utils/referral";
import { moneyScale, parseRequestKey, walletFor, walletRow } from "../../utils/wallet";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const user = requireUser(event);
  rateLimit(event, `referral-activation:${user.id}`, 12);
  const body = await readBody(event);
  const key = parseRequestKey(body?.requestKey);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length > 128 || !await verifyPassword(password, user.password_hash)) throw createError({ statusCode: 401, statusMessage: "Your password is incorrect." });
  transaction(() => {
    if (db().prepare("SELECT user_id FROM referral_activations WHERE user_id = ?").get(user.id)) return;
    const wallet = walletRow(user.id);
    const price = referralPrice * moneyScale;
    if (wallet.available < price) throw createError({ statusCode: 400, statusMessage: "You need 10 USDT in your available wallet balance to activate referrals." });
    if (db().prepare("SELECT id FROM wallet_transactions WHERE wallet_id = ? AND request_key = ?").get(wallet.id, key)) throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
    const transactionId = randomUUID(), timestamp = new Date().toISOString();
    db().prepare("UPDATE wallets SET available = available - ? WHERE id = ?").run(price, wallet.id);
    db().prepare("INSERT INTO wallet_transactions VALUES (?, ?, 'referral_purchase', ?, 'completed', 'Referral activation', ?, ?)").run(transactionId, wallet.id, price, key, timestamp);
    db().prepare("UPDATE users SET referral_code = ? WHERE id = ?").run(newReferralCode(), user.id);
    db().prepare("INSERT INTO referral_activations VALUES (?, ?, ?)").run(user.id, transactionId, timestamp);
  });
  return { user: accountFor(findUser(user.username)!), wallet: walletFor(user.id), program: referralProgram(user.id) };
});
