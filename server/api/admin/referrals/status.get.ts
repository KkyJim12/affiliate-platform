import { requireAdmin } from "../../../utils/auth";
import { db } from "../../../utils/database";
import { referralChainStatus, reconcilePendingChainOperations } from "../../../utils/referral-chain";
import { moneyScale } from "../../../utils/wallet";
export default defineEventHandler(async event => {
  const admin = await requireAdmin(event);
  await reconcilePendingChainOperations();
  const chain = await referralChainStatus(admin.id);
  const wallet = await db().one("SELECT address FROM evm_wallets WHERE user_id = $1", admin.id);
  const update = await db().one("SELECT status, transaction_hash FROM referral_chain_fee_updates ORDER BY created_at DESC LIMIT 1");
  const totals = await db().one(`SELECT COALESCE(SUM(amount),0) AS volume, COUNT(*) AS purchases FROM referral_chain_purchases WHERE status = 'confirmed'`);
  const paid = await db().one(`SELECT COALESCE(SUM(CASE WHEN reason = 'upline' THEN amount ELSE 0 END),0) AS commissions,
    COALESCE(SUM(CASE WHEN reason <> 'upline' THEN amount ELSE 0 END),0) AS platform FROM referral_chain_allocations`);
  return { chain, canManageFee: !!chain.owner && chain.owner.toLowerCase() === wallet?.address.toLowerCase(),
    feeUpdate: update ? { status: update.status, transactionHash: update.transaction_hash } : null,
    totals: { purchases: totals!.purchases, volume: totals!.volume / moneyScale, commissions: paid!.commissions / moneyScale, platform: paid!.platform / moneyScale } };
});
