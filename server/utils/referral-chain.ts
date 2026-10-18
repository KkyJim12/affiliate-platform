import { createError } from "h3";
import { Wallet, ZeroAddress, getAddress, id as hashId, parseUnits } from "ethers";
import { ReferralChainClient, uplineHash, type PreparedChainTransaction, type PurchasePayload } from "../lib/referral-chain";
import type { StoredEvmWallet } from "../lib/evm-wallet";
import { decryptEvmPrivateKey } from "../lib/evm-wallet";
import type { ChainPurchaseStatus, ReferralChainStatus } from "../../shared/referral-contract";
import { ledgerScale, levelPrice } from "../../shared/compensation";
import { polygonTestnet } from "../../shared/evm-wallet";
import { db, transaction } from "./database";
import { randomUUID } from "./auth";
import { newReferralCode, referralProgram } from "./referral";
import { audit } from "./admin";

export interface ChainPurchaseRow {
  id: string; user_id: string; level: number; amount: number; request_key: string;
  contract_address: string; token_address: string; buyer_address: string; fee_recipient_address: string;
  transaction_hash: string; payload: PurchasePayload; status: "pending" | "confirmed" | "failed";
}
interface FeeUpdateRow {
  id: string; admin_id: string; request_key: string; contract_address: string; owner_address: string;
  recipient_address: string; transaction_hash: string; status: "pending" | "confirmed" | "failed";
}
let client: ReferralChainClient | undefined;
export const referralPaymentMode = () => useRuntimeConfig().referral.paymentMode === "ledger" ? "ledger" : "contract";
export function referralChainClient() {
  const config = useRuntimeConfig();
  if (referralPaymentMode() === "ledger" || !config.referral.contractAddress || !config.referral.authorityPrivateKey || !config.evm.tokenAddress) return null;
  if (config.evm.chainId && Number(config.evm.chainId) !== polygonTestnet.chainId) throw new Error("Referral purchases require Polygon Amoy.");
  return client ??= new ReferralChainClient({ rpcUrl: config.evm.rpcUrl || polygonTestnet.rpcUrl,
    contractAddress: config.referral.contractAddress, tokenAddress: config.evm.tokenAddress,
    authorityPrivateKey: config.referral.authorityPrivateKey, minConfirmations: Number(config.referral.minConfirmations) });
}
function requireChainClient() {
  const result = referralChainClient();
  if (!result) throw createError({ statusCode: 503, statusMessage: "The referral smart contract is not configured yet." });
  return result;
}
export function chainPurchaseStatus(row: { id: string; level: number; status: ChainPurchaseStatus["status"]; transaction_hash: string }): ChainPurchaseStatus {
  return { id: row.id, level: row.level, status: row.status, transactionHash: row.transaction_hash,
    explorerUrl: `${polygonTestnet.explorerUrl}/tx/${row.transaction_hash}` };
}
export async function pendingChainPurchase(userId: string) {
  return await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE user_id = $1 AND status = 'pending'", userId);
}
export async function referralChainStatus(userId: string): Promise<ReferralChainStatus> {
  const pending = await pendingChainPurchase(userId);
  const base: ReferralChainStatus = { mode: referralPaymentMode(), configured: false, ready: false, chainId: 80002,
    contractAddress: null, tokenAddress: null, tokenSymbol: null, feeRecipient: null, owner: null, balance: null, gasBalance: null, gasBudget: null, currentLevel: null,
    pending: pending ? chainPurchaseStatus(pending) : null };
  try {
    const reader = referralChainClient();
    if (!reader) return base;
    const wallet = await db().one("SELECT address FROM evm_wallets WHERE user_id = $1", userId);
    const status = await reader.inspect(wallet?.address);
    return { ...base, configured: true, ready: !status.paused && !!wallet, contractAddress: getAddress(reader.config.contractAddress),
      tokenAddress: getAddress(reader.config.tokenAddress), feeRecipient: status.feeRecipient, owner: status.owner,
      balance: status.balance, gasBalance: status.gasBalance, gasBudget: status.gasBudget, tokenSymbol: status.tokenSymbol, currentLevel: status.currentLevel };
  } catch { return base; }
}

async function walletSigner(userId: string, password: string) {
  const row = await db().one<StoredEvmWallet>("SELECT address, public_key, encrypted_keystore, chain_id, created_at FROM evm_wallets WHERE user_id = $1", userId);
  if (!row) throw createError({ statusCode: 409, statusMessage: "Create your Polygon testnet wallet first." });
  return new Wallet(await decryptEvmPrivateKey(row, password));
}

async function withWalletLock<T>(userId: string, operation: () => Promise<T>) {
  const connection = await db().pool.connect();
  let locked = false;
  try {
    locked = (await connection.query("SELECT pg_try_advisory_lock(782439, hashtext($1)) AS locked", [userId])).rows[0].locked;
    if (!locked) throw createError({ statusCode: 409, statusMessage: "A wallet operation is already being prepared. Please try again." });
    return await operation();
  } finally {
    if (locked) await connection.query("SELECT pg_advisory_unlock(782439, hashtext($1))", [userId]);
    connection.release();
  }
}

async function saveTransactions(userId: string, operationId: string, prepared: PreparedChainTransaction[]) {
  for (const item of prepared) await db().execute(`INSERT INTO referral_chain_transactions
    (id, user_id, operation_id, stage, nonce, transaction_hash, raw_transaction, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    randomUUID(), userId, operationId, item.stage, item.nonce, item.hash, item.raw, new Date().toISOString());
}

export async function submitChainPurchase(userId: string, password: string, level: number, requestKey: string, maxGasFee: bigint) {
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
    if (await db().one("SELECT id FROM referral_chain_fee_updates WHERE admin_id = $1 AND status = 'pending'", userId))
      throw createError({ statusCode: 409, statusMessage: "Wait for your pending blockchain transaction to finish." });
    const signer = await walletSigner(userId, password);
    const state = await reader.inspect(signer.address);
    if (state.paused) throw createError({ statusCode: 409, statusMessage: "Referral smart contract purchases are paused." });
    const purchase = await transaction(async () => {
      await db().execute("SELECT pg_advisory_xact_lock(782438, 2)");
      const program = await referralProgram(userId);
      if (program.nextLevel !== level || (state.currentLevel !== 0 && state.currentLevel !== program.currentLevel))
        throw createError({ statusCode: 409, statusMessage: "Purchase the next referral level in order. The maximum is level 15." });
      const ancestors = await db().all(`WITH RECURSIVE ancestors AS (
        SELECT s.id, s.sponsor_id, 1 AS depth, ARRAY[$1::TEXT, s.id] AS path FROM users b JOIN users s ON s.id = b.sponsor_id WHERE b.id = $1 AND s.id <> b.id
        UNION ALL SELECT s.id, s.sponsor_id, a.depth + 1, a.path || s.id FROM ancestors a JOIN users s ON s.id = a.sponsor_id
        WHERE a.depth < 15 AND NOT s.id = ANY(a.path)
      ) SELECT a.id, a.depth, e.address, (r.user_id IS NOT NULL AND COALESCE(access.status,'active') = 'active' AND e.address IS NOT NULL) AS eligible
        FROM ancestors a LEFT JOIN referral_activations r ON r.user_id = a.id LEFT JOIN user_access access ON access.user_id = a.id
        LEFT JOIN evm_wallets e ON e.user_id = a.id ORDER BY a.depth`, userId);
      const recipients = Array.from({ length: 15 }, (_, index) => {
        const ancestor = ancestors.find(row => row.depth === index + 1);
        return { address: ancestor?.eligible ? getAddress(ancestor.address) : ZeroAddress,
          userId: ancestor?.eligible ? ancestor.id as string : null,
          reason: ancestor?.eligible ? "upline" as const : ancestor ? "ineligible_upline" as const : "missing_upline" as const };
      });
      const id = randomUUID(), timestamp = new Date().toISOString();
      const uplines = recipients.map(row => row.address);
      const block = await reader.provider.getBlock("latest");
      if (!block) throw new Error("Blockchain head unavailable.");
      const quote = { id: hashId(id), buyer: signer.address, level, previousLevel: program.currentLevel,
        uplinesHash: uplineHash(uplines), feeRecipient: state.feeRecipient, configNonce: state.configNonce, deadline: block.timestamp + 3600 };
      const payload: PurchasePayload = { createdBlock: block.number, quote, uplines, recipients: recipients.map(({ userId, reason }) => ({ userId, reason })), signature: await reader.sign(quote) };
      const prepared = await reader.preparePurchase(signer, payload, state.decimals, maxGasFee);
      const hash = prepared.find(item => item.stage === "purchase")!.hash;
      await db().execute(`INSERT INTO referral_chain_purchases
        (id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,transaction_hash,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,80002,$6,$7,$8,$9,$10,'pending',$11,$12,$12)`, id, userId, requestKey, level,
        levelPrice(level) * ledgerScale, getAddress(reader.config.contractAddress), getAddress(reader.config.tokenAddress), signer.address,
        state.feeRecipient, JSON.stringify(payload), hash, timestamp);
      await saveTransactions(userId, id, prepared);
      return (await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE id = $1", id))!;
    });
    return reconcileChainPurchase(purchase);
  });
}

async function rebroadcast(operationId: string, reader: ReferralChainClient) {
  const rows = await db().all("SELECT raw_transaction FROM referral_chain_transactions WHERE operation_id = $1 ORDER BY nonce", operationId);
  for (const row of rows) {
    try { await reader.broadcast(row.raw_transaction); }
    catch { /* A timeout is indeterminate. Keep the same signed bytes for recovery. */ }
  }
}

export async function reconcileChainPurchase(purchase: ChainPurchaseRow): Promise<ChainPurchaseRow> {
  if (purchase.status !== "pending") return purchase;
  const reader = requireChainClient();
  if (getAddress(purchase.contract_address) !== getAddress(reader.config.contractAddress) || getAddress(purchase.token_address) !== getAddress(reader.config.tokenAddress)) return purchase;
  await rebroadcast(purchase.id, reader);
  const evidence = await reader.verifyPurchase(purchase.transaction_hash, purchase.payload);
  if (!evidence) return purchase;
  await transaction(async () => {
    await db().execute("SELECT pg_advisory_xact_lock(782438, 2)");
    const current = await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE id = $1 FOR UPDATE", purchase.id);
    if (current?.status !== "pending") return;
    if (evidence.status === "confirmed") {
      for (const allocation of evidence.allocations) {
        const recipient = allocation.depth ? purchase.payload.recipients[allocation.depth - 1]! : null;
        await db().execute(`INSERT INTO referral_chain_allocations
          (purchase_id,kind,depth,amount,recipient_address,recipient_user_id,reason,log_index) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          purchase.id, allocation.kind, allocation.depth, allocation.units, allocation.recipient,
          allocation.redirected || allocation.kind === "platform" ? null : recipient?.userId,
          allocation.kind === "platform" ? "platform_fee" : recipient!.reason, allocation.logIndex);
      }
      if (!await db().one("SELECT user_id FROM referral_activations WHERE user_id = $1", purchase.user_id)) {
        await db().execute("UPDATE users SET referral_code = $1 WHERE id = $2", await newReferralCode(), purchase.user_id);
        await db().execute("INSERT INTO referral_activations (user_id, chain_purchase_id, created_at) VALUES ($1,$2,$3)", purchase.user_id, purchase.id, new Date().toISOString());
      }
    }
    await db().execute("UPDATE referral_chain_purchases SET status = $1, block_number = $2, block_hash = $3, updated_at = $4, transaction_hash = $6 WHERE id = $5",
      evidence.status, evidence.receipt.blockNumber, evidence.receipt.blockHash, new Date().toISOString(), purchase.id, evidence.receipt.hash);
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
    const purchases = await db().all<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE status = 'pending' ORDER BY created_at LIMIT 10");
    for (const row of purchases) { try { await reconcileChainPurchase(row); } catch { /* Retry on the next reconciliation pass. */ } }
    const updates = await db().all<FeeUpdateRow>("SELECT * FROM referral_chain_fee_updates WHERE status = 'pending' ORDER BY created_at LIMIT 5");
    for (const row of updates) { try { await reconcileFeeUpdate(row); } catch { /* Preserve indeterminate transactions. */ } }
  } finally { sweeping = false; }
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
