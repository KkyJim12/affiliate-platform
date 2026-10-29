import { requireAdmin } from "../../../utils/auth";
import { db } from "../../../utils/database";
import { referralChainStatus, reconcilePendingChainOperations } from "../../../utils/referral-chain";
import { moneyScale } from "../../../utils/wallet";
import { evmWalletFor } from "../../../utils/evm-wallet";
import { externalWalletMode } from "../../../utils/wallet-mode";
import { externalOperations } from "../../../utils/external-wallet";
export default defineEventHandler(async event => {
  const admin = await requireAdmin(event);
  await reconcilePendingChainOperations();
  const chain = await referralChainStatus(admin.id, !externalWalletMode());
  const wallet = await evmWalletFor(admin.id);
  const externalUpdate = externalWalletMode() ? (await externalOperations(admin.id)).find(item => item.kind === 'fee' && item.transactionHash) : null;
  const update = externalUpdate ? { status: externalUpdate.status,transaction_hash: externalUpdate.transactionHash }
    : await db().one("SELECT status, transaction_hash FROM referral_chain_fee_updates ORDER BY created_at DESC LIMIT 1");
  const totals = await db().one(`SELECT COALESCE(SUM(amount),0) AS volume, COUNT(*) AS purchases FROM referral_chain_purchases WHERE status = 'confirmed'`);
  const paid = await db().one(`SELECT COALESCE(SUM(CASE WHEN recipient_user_id IS NOT NULL AND status='credited' THEN amount ELSE 0 END),0) AS commissions,
    COALESCE(SUM(CASE WHEN recipient_user_id IS NULL THEN amount ELSE 0 END),0) AS platform FROM referral_chain_allocations`);
  return { chain, canManageFee: !!chain.owner && chain.owner.toLowerCase() === wallet?.address.toLowerCase(),
    feeUpdate: update ? { status: update.status, transactionHash: update.transaction_hash } : null,
    totals: { purchases: totals!.purchases, volume: totals!.volume / moneyScale, commissions: paid!.commissions / moneyScale, platform: paid!.platform / moneyScale } };
});
