import { appNetwork } from "./network";
import { commissionAuthorization } from "./commission-qualification";
import { referralRecipients } from "./matrix";
import { getAddress, id as hashId, ZeroHash, ZeroAddress } from "ethers";
import { randomUUID } from "node:crypto";
import { createError } from "h3";
import type { WalletCall, ExternalOperation } from "../../shared/connected-wallet";
import { ledgerScale, levelPrice } from "../../shared/compensation";
import { db, transaction } from "./database";
import { evmWalletFor } from "./evm-wallet";
import { withWalletLock, assertNoPendingWalletOperation } from "./evm-operations";
import { requireExternalWalletMode } from "./wallet-mode";
import { chainPurchaseStatus, pendingChainPurchase, reconcileChainPurchase, requireChainClient, type ChainPurchaseRow } from "./referral-chain";
import { distributorInterface, uplineHash, type PurchasePayload } from "../lib/referral-chain";
import { EvmSendClient, type SendPlan } from "../lib/evm-send";
import { referralProgram } from "./referral";
import { audit } from "./admin";

export async function connectedAddress(userId: string) {
  requireExternalWalletMode();
  const wallet = await evmWalletFor(userId);
  if (!wallet) throw createError({ statusCode: 409, statusMessage: "Link a connected wallet to your account first." });
  return wallet.address;
}
export async function prepareExternalPurchase(userId: string, level: number, requestKey: string, automaticApproval = false) {
  const address = await connectedAddress(userId), reader = requireChainClient();
  return withWalletLock(userId, async () => {
    let row = await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE user_id = $1 AND request_key = $2", userId, requestKey)
      ?? await pendingChainPurchase(userId);
    if (row) {
      if (row.level !== level || row.signing_mode !== "external") throw createError({ statusCode: 409, statusMessage: "Wait for your existing purchase to finish." });
      row = await reconcileChainPurchase(row);
      if (row.status !== "awaiting_signature") return { id: row.id, status: chainPurchaseStatus(row), calls: [] };
    } else {
      await assertNoPendingWalletOperation(userId);
      const state = await reader.inspect(address, level, false);
      if (state.paused) throw createError({ statusCode: 409, statusMessage: "Referral purchases are paused." });
      row = await transaction(async () => {
        await db().execute("SELECT pg_advisory_xact_lock(782438, 2)");
        const program = await referralProgram(userId);
        if (program.nextLevel !== level || (state.currentLevel !== 0 && state.currentLevel !== program.currentLevel))
          throw createError({ statusCode: 409, statusMessage: "Purchase the next referral level in order." });
        const recipients = await referralRecipients(userId, level, "external");
        const block = await reader.provider.getBlock("latest");
        if (!block) throw new Error("Chain head unavailable.");
        const id = randomUUID(), now = new Date().toISOString(), uplines = recipients.map(item => item.address);
        const quote = { ...await commissionAuthorization(userId,recipients,"external",level===1), id: hashId(id), buyer: address, level, previousLevel: program.currentLevel, uplinesHash: uplineHash(uplines),
          feeRecipient: state.feeRecipient, configNonce: state.configNonce, deadline: block.timestamp + 600, matrixCycle: ZeroHash };
        const payload: PurchasePayload = { createdBlock: block.number, quote, uplines, automaticApproval,
          recipients: recipients.map(({ userId, reason }) => ({ userId, reason })), signature: await reader.sign(quote) };
        // Only the authority attestation is signed here. Buyer transactions are signed in the extension.
        await reader.purchaseCalls(address, payload, state.decimals);
        await db().execute(`INSERT INTO referral_chain_purchases
          (id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,signing_mode,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,${appNetwork().chainId},$6,$7,$8,$9,$10,'awaiting_signature','external',$11,$11)`, id,userId,requestKey,level,
          levelPrice(level) * ledgerScale,getAddress(reader.config.contractAddress),getAddress(reader.config.tokenAddress),address,state.feeRecipient,JSON.stringify(payload),now);
        return (await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE id = $1", id))!;
      });
    }
    // Refuse stale deployment/configuration even when resuming an existing quote.
    const state = await reader.inspect(address, level, false);
    if (state.paused || row.payload.quote.configNonce !== state.configNonce) throw createError({ statusCode: 409, statusMessage: "This purchase quote is stale. Refresh after it expires." });
    const calls = await reader.purchaseCalls(address, row.payload, state.decimals);
    return { id: row.id, status: chainPurchaseStatus(row), calls: calls.map(call => ({ ...call, from: address, value: "0", chainId: appNetwork().chainId, gasLimit: call.gasLimit.toString() })) };
  });
}

export async function assertWalletTransaction(hash: unknown, call: WalletCall, provider = requireChainClient().provider) {
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw createError({ statusCode: 400, statusMessage: "Enter a valid transaction hash." });
  const tx = await provider.getTransaction(hash);
  if (!tx) throw createError({ statusCode: 409, statusMessage: "The wallet transaction is not visible yet. Refresh its status shortly." });
  if (call.chainId !== appNetwork().chainId || tx.chainId !== BigInt(call.chainId) || getAddress(tx.from) !== getAddress(call.from) || !tx.to || getAddress(tx.to) !== getAddress(call.to)
    || tx.data !== call.data || tx.value !== BigInt(call.value) || call.nonce !== undefined && tx.nonce !== call.nonce)
    throw createError({ statusCode: 400, statusMessage: "The wallet transaction does not match this action." });
  return hash;
}
export async function confirmExternalPurchase(userId: string, id: string, hash: unknown) {
  const address = await connectedAddress(userId), reader = requireChainClient();
  const row = await db().one<ChainPurchaseRow>("SELECT * FROM referral_chain_purchases WHERE id = $1 AND user_id = $2 AND signing_mode = 'external'", id, userId);
  if (!row) throw createError({ statusCode: 404, statusMessage: "Purchase not found." });
  if (row.status === "confirmed" || row.status === "failed") return chainPurchaseStatus(row);
  const validHash = await assertWalletTransaction(hash, { from: address, to: row.contract_address, value: "0", chainId: appNetwork().chainId,
    data: distributorInterface.encodeFunctionData("purchase", [row.payload.quote,row.payload.uplines,row.payload.signature]) }, reader.provider);
  await db().execute("UPDATE referral_chain_purchases SET transaction_hash = $1,status = 'pending',updated_at = $2 WHERE id = $3 AND status IN ('awaiting_signature','pending')", validHash,new Date().toISOString(),id);
  return chainPurchaseStatus(await reconcileChainPurchase({ ...row, status: "pending", transaction_hash: validHash }));
}

interface OperationRow { id: string; user_id: string; request_key: string; kind: "send" | "fee"; status: ExternalOperation["status"]; transaction_hash: string | null;
  payload: { call: WalletCall; plan?: SendPlan; recipient: string; contract?: string }; }
function sendClient() {
  const config = useRuntimeConfig().evm;
  return new EvmSendClient({ rpcUrl: config.rpcUrl || appNetwork().rpcUrl, chainId: appNetwork().chainId,
    tokenAddress: config.tokenAddress, minConfirmations: Number(config.minConfirmations || 2) });
}
function operationStatus(row: OperationRow): ExternalOperation {
  return { id: row.id, kind: row.kind, status: row.status, transactionHash: row.transaction_hash, call: row.payload.call,
    recipient: row.payload.recipient, amount: row.payload.plan?.amount, symbol: row.payload.plan?.symbol, gasBudget: row.payload.plan?.gasBudget };
}
export async function prepareExternalOperation(userId: string, key: string, kind: "send" | "fee", body: Record<string, unknown>) {
  const address = await connectedAddress(userId);
  return withWalletLock(userId, async () => {
    const existing = await db().one<OperationRow>("SELECT * FROM external_wallet_operations WHERE user_id = $1 AND request_key = $2",userId,key);
    if (existing) {
      if (existing.kind !== kind) throw createError({ statusCode: 409, statusMessage: "This request was already used for another action." });
      return operationStatus(existing);
    }
    await assertNoPendingWalletOperation(userId);
    let payload: OperationRow["payload"];
    if (kind === "send") {
      const plan = await sendClient().quote(address,String(body.recipient ?? ""),body.asset as "native" | "token",String(body.amount ?? ""));
      payload = { plan, recipient: plan.recipient, call: { from: address,to: plan.tx.to,data: plan.tx.data,value: plan.tx.value,nonce: plan.tx.nonce,chainId: appNetwork().chainId } };
    } else {
      const reader = requireChainClient(), state = await reader.inspect(undefined,undefined,false);
      let recipient: string;
      try { recipient = getAddress(String(body.address ?? "")); }
      catch { throw createError({ statusCode: 400,statusMessage: "Enter a valid fee recipient." }); }
      if (recipient === ZeroAddress || recipient === getAddress(reader.config.contractAddress)) throw createError({ statusCode: 400, statusMessage: "Enter a valid fee recipient." });
      if (state.owner !== address) throw createError({ statusCode: 403, statusMessage: "Connect the wallet that owns the referral contract." });
      payload = { recipient, contract: getAddress(reader.config.contractAddress), call: { from: address,to: getAddress(reader.config.contractAddress),
        data: distributorInterface.encodeFunctionData("setFeeRecipient",[recipient]), value: "0", chainId: appNetwork().chainId } };
    }
    const id = randomUUID(), now = new Date().toISOString();
    await db().execute("INSERT INTO external_wallet_operations (id,user_id,request_key,kind,payload,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)",id,userId,key,kind,JSON.stringify(payload),now);
    return operationStatus((await db().one<OperationRow>("SELECT * FROM external_wallet_operations WHERE id = $1",id))!);
  });
}
export async function reconcileExternalOperation(row: OperationRow) {
  if (!row.transaction_hash || row.status !== "pending") return row;
  const result = row.kind === "send" ? await sendClient().verify(row.transaction_hash,row.payload.plan!)
    : row.payload.contract === getAddress(requireChainClient().config.contractAddress)
      ? await requireChainClient().verifyFeeUpdate(row.transaction_hash,row.payload.call.from,row.payload.recipient) : null;
  if (result) await transaction(async () => {
    const locked = await db().one<OperationRow>("SELECT * FROM external_wallet_operations WHERE id = $1 FOR UPDATE",row.id);
    if (locked?.status !== "pending") return;
    await db().execute("UPDATE external_wallet_operations SET status = $1,updated_at = $2 WHERE id = $3",result.status,new Date().toISOString(),row.id);
    if (row.kind === "fee" && result.status === "confirmed") {
      const actual = await requireChainClient().contract.getFunction("feeRecipient")();
      await db().execute("UPDATE platform_settings SET fee_recipient_address = $1 WHERE id = 1",actual);
      await audit(row.user_id,"fee_address_updated_onchain",row.transaction_hash!);
    }
  });
  else await db().execute("UPDATE external_wallet_operations SET updated_at = $1 WHERE id = $2 AND status = 'pending'",new Date().toISOString(),row.id);
  return (await db().one<OperationRow>("SELECT * FROM external_wallet_operations WHERE id = $1",row.id))!;
}
export async function confirmExternalOperation(userId: string,id: string,hash: unknown) {
  await connectedAddress(userId);
  const row = await db().one<OperationRow>("SELECT * FROM external_wallet_operations WHERE id = $1 AND user_id = $2",id,userId);
  if (!row) throw createError({ statusCode: 404, statusMessage: "Wallet action not found." });
  if (row.status === "confirmed" || row.status === "failed") return operationStatus(row);
  const provider = row.kind === "send" ? sendClient().provider : requireChainClient().provider;
  const validHash = await assertWalletTransaction(hash,row.payload.call,provider);
  await db().execute("UPDATE external_wallet_operations SET transaction_hash = $1,status = 'pending',updated_at = $2 WHERE id = $3 AND status IN ('awaiting_signature','pending')",validHash,new Date().toISOString(),id);
  return operationStatus(await reconcileExternalOperation({ ...row,status: "pending",transaction_hash: validHash }));
}
export async function externalOperations(userId: string) {
  const rows = await db().all<OperationRow>("SELECT * FROM external_wallet_operations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",userId);
  return Promise.all(rows.map(async row => { try { return operationStatus(await reconcileExternalOperation(row)); } catch { return operationStatus(row); } }));
}
export async function reconcileExternalOperations() {
  const rows = await db().all<OperationRow>("SELECT * FROM external_wallet_operations WHERE status = 'pending' ORDER BY updated_at LIMIT 20");
  for (const row of rows) { try { await reconcileExternalOperation(row); } catch { /* Retry evidence reads later. */ } }
}
