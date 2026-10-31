import { ZeroAddress, getAddress } from "ethers";
import { db } from "./database.ts";

export async function paidReferralCount(userId: string, database = db()) {
  return (await database.one<{ count: number }>(`SELECT COUNT(*) AS count FROM users u
    JOIN referral_activations a ON a.user_id=u.id WHERE u.sponsor_id=$1`,userId))!.count;
}

// The quote authority attests historical paid direct referrals. New first
// activations are also counted on chain, independently of receipt polling order.
export async function commissionAuthorization(userId: string, recipients: { userId: string | null }[], mode: "external" | "embedded", firstActivation: boolean, database = db(), sponsorExempt = false) {
  const table = mode === "external" ? "connected_wallets" : "evm_wallets";
  const sponsor = await database.one<{ id: string; address: string | null }>(`SELECT u.sponsor_id AS id,w.address FROM users u
    LEFT JOIN ${table} w ON w.user_id=u.sponsor_id WHERE u.id=$1`,userId);
  const ids = [...new Set([...recipients.flatMap(row=>row.userId ? [row.userId] : []),...(sponsor?.id ? [sponsor.id] : [])])];
  const counts = await database.all<{ id: string; count: number }>(`SELECT u.sponsor_id AS id,COUNT(*) AS count
    FROM users u JOIN referral_activations a ON a.user_id=u.id WHERE u.sponsor_id=ANY($1::TEXT[]) GROUP BY u.sponsor_id`,ids);
  const count = (id: string | null) => counts.find(row=>row.id===id)?.count ?? 0;
  let qualifiedMask = 0;
  recipients.forEach((row,index)=>{if (row.userId && count(row.userId)>=2) qualifiedMask |= 1 << index;});
  if (sponsor?.id && count(sponsor.id)+(firstActivation ? 1 : 0)>=2) qualifiedMask |= 1 << 18;
  return { sponsor: sponsor?.address ? getAddress(sponsor.address) : ZeroAddress, qualifiedMask, sponsorExempt };
}

export async function commissionQualification(userId: string, database = db()) {
  const count = await paidReferralCount(userId,database);
  const held = await database.one<{ amount: number }>(`SELECT COALESCE(SUM(amount),0) AS amount FROM (
    SELECT amount FROM referral_allocations WHERE recipient_user_id=$1 AND status='held'
    UNION ALL SELECT amount FROM referral_chain_allocations WHERE recipient_user_id=$1 AND status='held'
  ) amounts`,userId);
  return { paidReferrals:count,required:2,qualified:count>=2,heldBalance:held!.amount/1_000_000 };
}

export async function reconcileHeldChainAllocations(database = db()) {
  await database.execute(`UPDATE referral_chain_allocations a SET status='credited'
    FROM referral_chain_purchases p WHERE p.id=a.purchase_id AND p.status='confirmed' AND a.status='held' AND EXISTS(
      SELECT 1 FROM referral_commission_releases r WHERE lower(r.contract_address)=lower(p.contract_address)
        AND lower(r.recipient_address)=lower(a.recipient_address)
        AND (r.block_number>p.block_number OR (r.block_number=p.block_number AND r.log_index>a.log_index)))`);
}
