import { completeRebirth, rebirthRecipients, referralRecipients, unlockMatrixLevel, type ReferralJob } from "./matrix";
import { createError } from "h3";
import { commissionAuthorization, reconcileHeldChainAllocations } from "./commission-qualification";
import { ZeroHash, getAddress, id as hashId, parseUnits } from "ethers";
import { ReferralChainClient, uplineHash, type PreparedChainTransaction, type PurchasePayload, type QualificationPayload } from "../lib/referral-chain";
import { assertNoPendingWalletOperation, walletSigner, withWalletLock } from "./evm-operations";
import type { ChainPurchaseStatus, ReferralChainStatus } from "../../shared/referral-contract";
import { ledgerScale, levelPrice } from "../../shared/compensation";
import { appNetwork } from "./network";
import { db, transaction } from "./database";
import { randomUUID } from "./auth";
import { referralProgram } from "./referral";
import { audit } from "./admin";
import { evmWalletFor } from "./evm-wallet";
import { externalWalletMode } from "./wallet-mode";
import { queuedReferralJobs, retryFailedReferralJobs } from "./referral-auto-retry";

export interface ChainPurchaseRow {
  id: string; user_id: string; level: number; amount: number; request_key: string;
  contract_address: string; token_address: string; buyer_address: string; fee_recipient_address: string;
  transaction_hash: string | null; payload: PurchasePayload; status: ChainPurchaseStatus["status"];
  signing_mode: "external" | "embedded" | "automatic";
  rebirth_id?: string | null;
}
interface FeeUpdateRow {
  id: string; admin_id: string; request_key: string; contract_address: string; owner_address: string;
  recipient_address: string; transaction_hash: string; status: "pending" | "confirmed" | "failed";
}
let client: ReferralChainClient | undefined;
export const referralPaymentMode = () => !externalWalletMode() && useRuntimeConfig().referral.paymentMode === "ledger" ? "ledger" : "contract";
export function referralChainClient() {
  const config = useRuntimeConfig();
  if (referralPaymentMode() === "ledger" || !config.referral.contractAddress || !config.referral.authorityPrivateKey || !config.evm.tokenAddress) return null;
  appNetwork();
  return client ??= new ReferralChainClient({ chainId: appNetwork().chainId, rpcUrl: config.evm.rpcUrl || appNetwork().rpcUrl,
    contractAddress: config.referral.contractAddress, tokenAddress: config.evm.tokenAddress,
    authorityPrivateKey: config.referral.authorityPrivateKey, minConfirmations: Number(config.referral.minConfirmations), minGasBalance: config.referral.minGasBalance });
}
export function requireChainClient() {
  const result = referralChainClient();
  if (!result) throw createError({ statusCode: 503, statusMessage: "The referral smart contract is not configured yet." });
  return result;
}
export function chainPurchaseStatus(row: { id: string; level: number; status: ChainPurchaseStatus["status"]; transaction_hash: string | null; rebirth_id?: string | null }): ChainPurchaseStatus {
  return { id: row.id, kind: row.rebirth_id ? "rebirth" : "purchase", level: row.level, status: row.status, transactionHash: row.transaction_hash,
    explorerUrl: row.transaction_hash ? `${appNetwork().explorerUrl}/tx/${row.transaction_hash}` : null };
}
export async function pendingChainPurchase(userId: string) {
  return await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE user_id = $1 AND status IN ('pending','awaiting_signature')", userId);
}
export async function referralChainStatus(userId: string, includeGas = false): Promise<ReferralChainStatus> {
  const pending = await pendingChainPurchase(userId);
  const base: ReferralChainStatus = { mode: referralPaymentMode(), configured: false, ready: false, chainId: appNetwork().chainId,
    contractAddress: null, tokenAddress: null, tokenSymbol: null, feeRecipient: null, owner: null, balance: null, gasBalance: null, gasBudget: null, currentLevel: null,
    pending: pending ? chainPurchaseStatus(pending) : null };
  try {
    const reader = referralChainClient();
    if (!reader) return base;
    const wallet = await evmWalletFor(userId);
    const program = wallet ? await referralProgram(userId) : null;
    const status = await reader.inspect(wallet?.address, program?.nextLevel, includeGas);
    return { ...base, configured: true, ready: !status.paused && !!wallet, contractAddress: getAddress(reader.config.contractAddress),
      tokenAddress: getAddress(reader.config.tokenAddress), feeRecipient: status.feeRecipient, owner: status.owner,
      balance: status.balance, gasBalance: status.gasBalance, gasBudget: status.gasBudget, tokenSymbol: status.tokenSymbol, currentLevel: status.currentLevel };
  } catch (error) { return { ...base, error: error instanceof Error && error.message.startsWith("Deploy the updated") ? error.message : "The referral contract is unavailable. Please try again later." }; }
}

async function saveTransactions(userId: string, operationId: string, prepared: PreparedChainTransaction[]) {
  for (const item of prepared) await db().execute(`INSERT INTO referral_chain_transactions
    (id, user_id, operation_id, stage, nonce, transaction_hash, raw_transaction, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    randomUUID(), userId, operationId, item.stage, item.nonce, item.hash, item.raw, new Date().toISOString());
}

export async function submitChainPurchase(userId: string, password: string, level: number, requestKey: string, automaticApproval = false) {
  const reader = requireChainClient();
  return withWalletLock(userId, async () => {
    const previous = await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE user_id = $1 AND request_key = $2", userId, requestKey);
    if (previous) {
      if (previous.level !== level) throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
      return reconcileChainPurchase(previous);
    }
    const pending = await pendingChainPurchase(userId);
    if (pending) {
      if (pending.level !== level) throw createError({ statusCode: 409, statusMessage: "Wait for your pending blockchain purchase to finish." });
      return reconcileChainPurchase(pending);
    }
    await assertNoPendingWalletOperation(userId);
    const signer = await walletSigner(userId, password);
    const state = await reader.inspect(signer.address, undefined, false);
    if (state.paused) throw createError({ statusCode: 409, statusMessage: "Referral smart contract purchases are paused." });
    const purchase = await transaction(async () => {
      await db().execute("SELECT pg_advisory_xact_lock(782438, 2)");
      const program = await referralProgram(userId);
      if (program.nextLevel !== level || (state.currentLevel !== 0 && state.currentLevel !== program.currentLevel))
        throw createError({ statusCode: 409, statusMessage: "Purchase the next referral level in order. The maximum is level 15." });
      const recipients = await referralRecipients(userId, level, "embedded");
      const id = randomUUID(), timestamp = new Date().toISOString();
      const uplines = recipients.map(row => row.address);
      const block = await reader.provider.getBlock("latest");
      if (!block) throw new Error("Blockchain head unavailable.");
      const quote = { ...await commissionAuthorization(userId,recipients,"embedded",level===1), id: hashId(id), buyer: signer.address, level, previousLevel: program.currentLevel,
        uplinesHash: uplineHash(uplines), feeRecipient: state.feeRecipient, configNonce: state.configNonce, deadline: block.timestamp + 3600, matrixCycle: ZeroHash };
      const payload: PurchasePayload = { createdBlock: block.number, quote, uplines, automaticApproval, recipients: recipients.map(({ userId, reason }) => ({ userId, reason })), signature: await reader.sign(quote) };
      const prepared = await reader.preparePurchase(signer, payload, state.decimals);
      const hash = prepared.find(item => item.stage === "purchase")!.hash;
      await db().execute(`INSERT INTO referral_chain_purchases
        (id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,transaction_hash,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,${appNetwork().chainId},$6,$7,$8,$9,$10,'pending',$11,$12,$12)`, id, userId, requestKey, level,
        levelPrice(level) * ledgerScale, getAddress(reader.config.contractAddress), getAddress(reader.config.tokenAddress), signer.address,
        state.feeRecipient, JSON.stringify(payload), hash, timestamp);
      await saveTransactions(userId, id, prepared);
      return (await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE id = $1", id))!;
    });
    return reconcileChainPurchase(purchase);
  });
}

async function rebroadcast(operationId: string, reader: ReferralChainClient) {
  if (externalWalletMode() && !(await db().one("SELECT id FROM referral_chain_purchases WHERE id = $1 AND signing_mode = 'automatic'", operationId))) return;
  const rows = await db().all("SELECT raw_transaction FROM referral_chain_transactions WHERE operation_id = $1 ORDER BY nonce", operationId);
  for (const row of rows) {
    try { await reader.broadcast(row.raw_transaction); }
    catch { /* A timeout is indeterminate. Keep the same signed bytes for recovery. */ }
  }
}

export async function reconcileChainPurchase(purchase: ChainPurchaseRow): Promise<ChainPurchaseRow> {
  if (purchase.status !== "pending" && purchase.status !== "awaiting_signature") return purchase;
  const configured = requireChainClient();
  const reader = getAddress(purchase.contract_address) === getAddress(configured.config.contractAddress) && getAddress(purchase.token_address) === getAddress(configured.config.tokenAddress)
    ? configured : new ReferralChainClient({ ...configured.config,contractAddress: purchase.contract_address,tokenAddress: purchase.token_address });
  await rebroadcast(purchase.id, reader);
  const evidence = await reader.verifyPurchase(purchase.transaction_hash, purchase.payload);
  if (!evidence) {
    if (purchase.signing_mode === "external") {
      const head = await reader.provider.getBlockNumber();
      const finalized = await reader.provider.getBlock(Math.max(0, head - reader.config.minConfirmations + 1));
      // No new valid transaction can appear once the quote is expired in a finalized block.
      if (finalized && finalized.timestamp > purchase.payload.quote.deadline
        && !await reader.contract.getFunction("purchased")(purchase.payload.quote.id)) {
        await db().execute("UPDATE referral_chain_purchases SET status = 'failed',updated_at = $1 WHERE id = $2 AND status IN ('pending','awaiting_signature')",new Date().toISOString(),purchase.id);
        return { ...purchase,status: "failed" };
      }
    }
    await db().execute("UPDATE referral_chain_purchases SET updated_at = $1 WHERE id = $2 AND status IN ('pending','awaiting_signature')",new Date().toISOString(),purchase.id);
    return purchase;
  }
  await transaction(async () => {
    await db().execute("SELECT pg_advisory_xact_lock(782438, 2)");
    const current = await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE id = $1 FOR UPDATE", purchase.id);
    if (current?.status !== "pending" && current?.status !== "awaiting_signature") return;
    if (evidence.status === "confirmed") {
      const version3 = purchase.payload.uplines.length === 18;
      for (const allocation of evidence.allocations) {
        const position = version3 ? (allocation.kind === "bonus" ? 3 : 0) + allocation.depth - 1 : allocation.depth - 1;
        const recipient = allocation.recipientDepth ? purchase.payload.recipients[version3 ? position : allocation.recipientDepth - 1]! : null;
        await db().execute(`INSERT INTO referral_chain_allocations
          (purchase_id,kind,depth,amount,recipient_address,recipient_user_id,reason,log_index,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          purchase.id, allocation.kind, allocation.depth, allocation.units, allocation.recipient,
          recipient?.userId ?? null,
          allocation.kind === "platform" ? "platform_fee" : allocation.recipientDepth ? allocation.redirected ? "highest_upline" : "upline" : purchase.payload.recipients[position]!.reason, allocation.logIndex,allocation.held ? 'held' : 'credited');
      }
      for(const release of evidence.releases) await db().execute(`INSERT INTO referral_commission_releases
        (contract_address,transaction_hash,log_index,block_number,recipient_address,amount) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        purchase.contract_address,evidence.receipt.hash,release.logIndex,evidence.receipt.blockNumber,release.recipient,release.amount);
      if (!await db().one("SELECT user_id FROM referral_activations WHERE user_id = $1", purchase.user_id)) {
        await db().execute("INSERT INTO referral_activations (user_id, chain_purchase_id, created_at) VALUES ($1,$2,$3)", purchase.user_id, purchase.id, new Date().toISOString());
      }
    }
    await db().execute("UPDATE referral_chain_purchases SET status = $1, block_number = $2, block_hash = $3, updated_at = $4, transaction_hash = $6 WHERE id = $5",
      evidence.status, evidence.receipt.blockNumber, evidence.receipt.blockHash, new Date().toISOString(), purchase.id, evidence.receipt.hash);
    // Handles receipts finalized out of order, including a release in the same
    // block as a held allocation whose receipt is reconciled later.
    if (evidence.status === 'confirmed') await reconcileHeldChainAllocations();
    if (evidence.status === "confirmed") {
      const rebirth = await db().one<ReferralJob>("SELECT * FROM referral_auto_upgrades WHERE purchase_id=$1 AND kind='rebirth'",purchase.id);
      if (rebirth) await completeRebirth(rebirth);
      else await unlockMatrixLevel(purchase.user_id, purchase.level);
      await db().execute("UPDATE referral_auto_upgrades SET status = 'completed',last_error = NULL WHERE purchase_id = $1", purchase.id);
    } else {
      await retryFailedReferralJobs();
    }
  });
  return (await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE id = $1", purchase.id))!;
}

export async function submitFeeUpdate(adminId: string, password: string, address: string, key: string, maxGasFee: bigint) {
  const reader = requireChainClient();
  return withWalletLock(adminId, async () => {
    const existing = await db().one<FeeUpdateRow>("SELECT * FROM referral_chain_fee_updates WHERE admin_id = $1 AND request_key = $2", adminId, key);
    if (existing) {
      if (getAddress(existing.recipient_address) !== getAddress(address)) throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
      return reconcileFeeUpdate(existing);
    }
    if (await pendingChainPurchase(adminId) || await db().one("SELECT id FROM referral_chain_fee_updates WHERE status = 'pending'"))
      throw createError({ statusCode: 409, statusMessage: "Wait for your pending blockchain transaction to finish." });
    await assertNoPendingWalletOperation(adminId);
    const signer = await walletSigner(adminId, password);
    const state = await reader.inspect();
    if (state.owner !== signer.address) throw createError({ statusCode: 403, statusMessage: "Your admin wallet must own the referral contract to change its fee address." });
    if (getAddress(address) === getAddress(reader.config.contractAddress)) throw createError({ statusCode: 400, statusMessage: "Enter a valid, nonzero EVM platform fee address." });
    const prepared = await reader.prepareFeeUpdate(signer, address, maxGasFee);
    const id = randomUUID();
    await transaction(async () => {
      await db().execute("SELECT id FROM platform_settings WHERE id = 1 FOR UPDATE");
      if (await db().one("SELECT id FROM referral_chain_fee_updates WHERE status = 'pending'"))
        throw createError({ statusCode: 409, statusMessage: "Wait for your pending blockchain transaction to finish." });
      await db().execute(`INSERT INTO referral_chain_fee_updates
        (id,admin_id,request_key,contract_address,owner_address,recipient_address,transaction_hash,status,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)`, id, adminId, key, getAddress(reader.config.contractAddress), signer.address,
        getAddress(address), prepared[0]!.hash, new Date().toISOString());
      await saveTransactions(adminId, id, prepared);
    });
    return reconcileFeeUpdate((await db().one<FeeUpdateRow>("SELECT * FROM referral_chain_fee_updates WHERE id = $1", id))!);
  });
}

async function reconcileFeeUpdate(update: FeeUpdateRow): Promise<FeeUpdateRow> {
  if (update.status !== "pending") return update;
  const reader = requireChainClient();
  if (getAddress(reader.config.contractAddress) !== getAddress(update.contract_address)) return update;
  await rebroadcast(update.id, reader);
  const result = await reader.verifyFeeUpdate(update.transaction_hash, update.owner_address, update.recipient_address);
  if (!result) return update;
  await transaction(async () => {
    const current = await db().one<FeeUpdateRow>("SELECT * FROM referral_chain_fee_updates WHERE id = $1 FOR UPDATE", update.id);
    if (current?.status !== "pending") return;
    await db().execute("UPDATE referral_chain_fee_updates SET status = $1 WHERE id = $2", result.status, update.id);
    if (result.status === "confirmed") {
      // Read current chain state: another confirmed owner transaction may follow.
      const recipient = await reader.contract.getFunction("feeRecipient")();
      await db().execute("UPDATE platform_settings SET fee_recipient_address = $1 WHERE id = 1", recipient);
      await audit(update.admin_id, "fee_address_updated_onchain", update.transaction_hash);
    }
  });
  return (await db().one<FeeUpdateRow>("SELECT * FROM referral_chain_fee_updates WHERE id = $1", update.id))!;
}

let sweeping = false;
export async function reconcilePendingChainOperations() {
  if (sweeping || referralPaymentMode() !== "contract") return;
  sweeping = true;
  try {
    const purchases = await db().all<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE status IN ('pending','awaiting_signature') ORDER BY updated_at LIMIT 10");
    for (const row of purchases) { try { await reconcileChainPurchase(row); } catch { /* Retry on the next reconciliation pass. */ } }
    const updates = await db().all<FeeUpdateRow>("SELECT * FROM referral_chain_fee_updates WHERE status = 'pending' ORDER BY created_at LIMIT 5");
    for (const row of updates) { try { await reconcileFeeUpdate(row); } catch { /* Preserve indeterminate transactions. */ } }
    await retryFailedReferralJobs();
    await processCommissionQualifications();
    await processReferralAutoUpgrades();
  } finally { sweeping = false; }
}

async function processCommissionQualifications() {
  const reader=referralChainClient();
  if(!reader) return;
  await withWalletLock('referral-auto-upgrade-relayer',async()=>{
    const pending=await db().one<{id:string;contract_address:string;token_address:string;transaction_hash:string;raw_transaction:string;payload:QualificationPayload}>(
      "SELECT * FROM referral_qualification_transactions WHERE status='pending' LIMIT 1");
    if(pending) {
      const client=getAddress(pending.contract_address)===getAddress(reader.config.contractAddress) && getAddress(pending.token_address)===getAddress(reader.config.tokenAddress)
        ? reader : new ReferralChainClient({...reader.config,contractAddress:pending.contract_address,tokenAddress:pending.token_address});
      await client.broadcast(pending.raw_transaction);
      const evidence=await client.verifyQualification(pending.transaction_hash,pending.payload);
      if(!evidence) return;
      await transaction(async()=>{
        await db().execute("SELECT pg_advisory_xact_lock(782438,2)");
        for(const release of evidence.releases) await db().execute(`INSERT INTO referral_commission_releases
          (contract_address,transaction_hash,log_index,block_number,recipient_address,amount) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          pending.contract_address,evidence.receipt.hash,release.logIndex,evidence.receipt.blockNumber,release.recipient,release.amount);
        await db().execute('UPDATE referral_qualification_transactions SET status=$1 WHERE id=$2',evidence.status,pending.id);
        await reconcileHeldChainAllocations();
      });
    }
    if(await db().one("SELECT id FROM referral_chain_purchases WHERE signing_mode='automatic' AND status='pending' LIMIT 1")) return;
    const candidates=await db().all<{user_id:string;address:string}>(`SELECT a.recipient_user_id AS user_id,a.recipient_address AS address
      FROM referral_chain_allocations a JOIN referral_chain_purchases p ON p.id=a.purchase_id
      WHERE a.status='held' AND p.status='confirmed' AND lower(p.contract_address)=lower($1) AND (
        SELECT COUNT(*) FROM users u JOIN referral_activations paid ON paid.user_id=u.id WHERE u.sponsor_id=a.recipient_user_id)>=2
      GROUP BY a.recipient_user_id,a.recipient_address ORDER BY MIN(p.created_at) LIMIT 20`,reader.config.contractAddress);
    for(const candidate of candidates) {
      if(await reader.contract.getFunction('heldCommissions')(candidate.address)===0n) continue;
      const {payload,prepared}=await reader.prepareQualification(candidate.address),tx=prepared[0]!,id=randomUUID();
      await db().execute(`INSERT INTO referral_qualification_transactions(id,user_id,contract_address,token_address,payload,raw_transaction,transaction_hash,status,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8)`,id,candidate.user_id,getAddress(reader.config.contractAddress),getAddress(reader.config.tokenAddress),JSON.stringify(payload),tx.raw,tx.hash,new Date().toISOString());
      await reader.broadcast(tx.raw);
      break;
    }
  }).catch(()=>{});
}

async function processReferralAutoUpgrades() {
  const reader = referralChainClient();
  if (!reader) return;
  // One persisted relayer transaction at a time, across app instances. This
  // avoids reusing an authority nonce when broadcasting times out.
  await withWalletLock("referral-auto-upgrade-relayer", async () => {
    if(await db().one("SELECT id FROM referral_qualification_transactions WHERE status='pending' LIMIT 1")) return;
    if (await db().one("SELECT id FROM referral_chain_purchases WHERE signing_mode = 'automatic' AND status = 'pending' LIMIT 1")) return;
    const jobs = await queuedReferralJobs();
    for (const job of jobs) {
      await db().execute("UPDATE referral_auto_upgrades SET last_attempt_at = $1 WHERE cycle_id = $2", new Date().toISOString(),job.cycle_id);
      try {
        const purchase = await withWalletLock(job.user_id, () => transaction(async () => {
          await db().execute("SELECT pg_advisory_xact_lock(782438, 2)");
          const currentJob = await db().one<{status: string}>("SELECT status FROM referral_auto_upgrades WHERE cycle_id=$1 FOR UPDATE",job.cycle_id);
          if (currentJob?.status !== 'queued') return null;
          if (await db().one("SELECT user_id FROM user_access WHERE user_id = $1 AND status <> 'active'",job.user_id)) throw new Error("Waiting for an active member account.");
          const program = await referralProgram(job.user_id);
          if (job.kind === 'upgrade' && program.currentLevel >= job.level) {
            await db().execute("UPDATE referral_auto_upgrades SET status = 'superseded',last_error = NULL WHERE cycle_id = $1", job.cycle_id);
            return null;
          }
          if (job.kind === 'upgrade' && (program.nextLevel !== job.level || await db().one("SELECT cycle_id FROM referral_auto_upgrades WHERE cycle_id=$1 AND status<>'completed'",`rebirth:${job.cycle_id}`))) return null;
          if (await pendingChainPurchase(job.user_id)) return null;
          await assertNoPendingWalletOperation(job.user_id);
          const wallet = await evmWalletFor(job.user_id);
          if (!wallet) throw new Error("Waiting for a linked token wallet.");
          const state = await reader.inspect(wallet.address, job.level, false);
          if (state.paused) throw new Error("Automatic upgrades are paused with contract purchases.");
          if (state.currentLevel !== 0 && state.currentLevel !== program.currentLevel) throw new Error("Waiting for level reconciliation.");
          const mode = externalWalletMode() ? "external" : "embedded";
          const recipients = job.kind === 'rebirth' ? await rebirthRecipients(job,mode) : await referralRecipients(job.user_id,job.level,mode);
          const uplines = recipients.map(item => item.address), block = await reader.provider.getBlock("latest");
          if (!block) throw new Error("Chain head unavailable.");
          const id = randomUUID(), timestamp = new Date().toISOString();
          const quote = { ...await commissionAuthorization(job.user_id,recipients,mode,false), id: hashId(id), buyer: wallet.address, level: job.level, previousLevel: program.currentLevel,
            uplinesHash: uplineHash(uplines), feeRecipient: state.feeRecipient, configNonce: state.configNonce,
            deadline: block.timestamp + 3600, matrixCycle: hashId(job.cycle_id) };
          const payload: PurchasePayload = { createdBlock: block.number, quote, uplines,
            rebirth: job.kind === 'rebirth',
            recipients: recipients.map(({ userId, reason }) => ({ userId, reason })), signature: await reader.sign(quote) };
          const prepared = await reader.prepareAutoUpgrade(payload, state.decimals);
          await db().execute(`INSERT INTO referral_chain_purchases
            (id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,signing_mode,transaction_hash,created_at,updated_at,rebirth_id)
            VALUES($1,$2,$3,$4,$5,${appNetwork().chainId},$6,$7,$8,$9,$10,'pending','automatic',$11,$12,$12,$13)`,
            id,job.user_id,`referral-auto:${id}`,job.level,levelPrice(job.level) * ledgerScale,getAddress(reader.config.contractAddress),
            getAddress(reader.config.tokenAddress),wallet.address,state.feeRecipient,JSON.stringify(payload),prepared[0]!.hash,timestamp,job.kind === 'rebirth' ? job.cycle_id : null);
          await saveTransactions(job.user_id, id, prepared);
          await db().execute("UPDATE referral_auto_upgrades SET status = 'pending',purchase_id = $1,last_error = NULL WHERE cycle_id = $2", id,job.cycle_id);
          return (await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE id = $1", id))!;
        }));
        if (purchase) {
          // Once signed bytes are committed, stop this pass even if RPC
          // reconciliation fails. The relayer nonce is reserved by this payment.
          try { await reconcileChainPurchase(purchase); } catch { /* Retry the persisted transaction on the next pass. */ }
          break;
        }
      } catch (error) {
        // Persist only our own public explanations, never RPC payloads or raw txs.
        const message = error instanceof Error && /^(Waiting for |Automatic upgrades are paused)/.test(error.message)
          ? error.message : job.kind === 'rebirth'
            ? "Automatic reborn will retry when the contract and relayer are available."
            : "Automatic upgrade will retry when the contract and relayer are available.";
        await db().execute("UPDATE referral_auto_upgrades SET last_error = $1 WHERE cycle_id = $2 AND status = 'queued'", message,job.cycle_id);
      }
    }
  }).catch(() => {});
}

export function chainActionError(error: unknown): never {
  if (typeof error === "object" && error && "statusCode" in error) throw error;
  const message = error instanceof Error ? error.message : "";
  if (message === "INSUFFICIENT_TOKEN") throw createError({ statusCode: 400, statusMessage: "Your on-chain USDT balance is too low for this purchase." });
  if (message === "INSUFFICIENT_GAS") throw createError({ statusCode: 400, statusMessage: "Add POL to your Amoy wallet to cover transaction gas." });
  if (message === "GAS_PRICE_CHANGED") throw createError({ statusCode: 409, statusMessage: "Gas prices changed. Refresh the gas estimate and confirm again." });
  throw createError({ statusCode: 503, statusMessage: "The blockchain request could not be completed. Check purchase status before trying again." });
}

export function parseGasBudget(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,18})?$/.test(value) || parseUnits(value, 18) <= 0n)
    throw createError({ statusCode: 400, statusMessage: "Refresh the gas estimate before confirming this transaction." });
  return parseUnits(value, 18);
}
