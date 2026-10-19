import { createError } from "h3";
import { getAddress } from "ethers";
import { EvmSendClient, EvmSendError, sendPlanHash, type SendPlan } from "../lib/evm-send";
import type { EvmSendAsset, EvmSendQuote, EvmSendStatus } from "../../shared/evm-send";
import { polygonTestnet } from "../../shared/evm-wallet";
import { db, transaction } from "./database";
import { randomUUID } from "./auth";
import { assertNoPendingWalletOperation, walletSigner, withWalletLock } from "./evm-operations";

interface SendRow {
  id: string; user_id: string; request_key: string | null; payload: SendPlan; quote_hash: string;
  sender_address: string; token_address: string | null; status: "quoted" | EvmSendStatus["status"];
  raw_transaction: string | null; transaction_hash: string | null; created_at: string;
}
let client: EvmSendClient | undefined;
function sendClient() {
  const { evm } = useRuntimeConfig();
  return client ??= new EvmSendClient({ rpcUrl: evm.rpcUrl || polygonTestnet.rpcUrl, chainId: evm.chainId,
    tokenAddress: evm.tokenAddress, minConfirmations: Number(evm.minConfirmations || 2) });
}
export function sendStatus(row: SendRow): EvmSendStatus {
  if (row.status === "quoted" || !row.transaction_hash) throw new Error("Unsigned send has no status.");
  return { id: row.id, status: row.status, recipient: row.payload.recipient, asset: row.payload.asset,
    amount: row.payload.amount, symbol: row.payload.symbol, transactionHash: row.transaction_hash,
    explorerUrl: `${polygonTestnet.explorerUrl}/tx/${row.transaction_hash}`, createdAt: row.created_at };
}
export async function createSendQuote(userId: string, recipient: string, asset: EvmSendAsset, amount: string): Promise<EvmSendQuote> {
  return withWalletLock(userId, async () => {
    await assertNoPendingWalletOperation(userId);
    const wallet = await db().one("SELECT address FROM evm_wallets WHERE user_id = $1", userId);
    if (!wallet) throw createError({ statusCode: 409, statusMessage: "Create your Polygon testnet wallet first." });
    const plan = await sendClient().quote(wallet.address, recipient, asset, amount);
    const id = randomUUID(), quoteHash = sendPlanHash(plan), timestamp = new Date().toISOString();
    await db().execute(`INSERT INTO evm_sends (id,user_id,chain_id,sender_address,token_address,payload,quote_hash,status,created_at,updated_at)
      VALUES ($1,$2,80002,$3,$4,$5,$6,'quoted',$7,$7)`, id, userId, plan.sender, plan.tokenAddress, JSON.stringify(plan), quoteHash, timestamp);
    return { id, quoteHash, sender: plan.sender, recipient: plan.recipient, asset: plan.asset, tokenAddress: plan.tokenAddress,
      symbol: plan.symbol, decimals: plan.decimals, amount: plan.amount, gasBudget: plan.gasBudget, chainId: 80002, expiresAt: new Date(plan.deadline).toISOString() };
  });
}
export async function submitEvmSend(userId: string, password: string, id: string, quoteHash: string, requestKey: string) {
  return withWalletLock(userId, async () => {
    const previous = await db().one<SendRow>("SELECT * FROM evm_sends WHERE user_id = $1 AND request_key = $2", userId, requestKey);
    if (previous && previous.id !== id) throw createError({ statusCode: 409, statusMessage: "This request was already used for another transaction." });
    const row = await db().one<SendRow>("SELECT * FROM evm_sends WHERE id = $1 AND user_id = $2", id, userId);
    if (!row) throw createError({ statusCode: 404, statusMessage: "This send quote is unavailable. Review the transfer again." });
    if (row.quote_hash !== quoteHash || sendPlanHash(row.payload) !== quoteHash) throw new EvmSendError("quote");
    // The quote itself is single use, even if a browser creates a new request key.
    if (row.status !== "quoted") return reconcileEvmSend(row);
    if (row.payload.deadline <= Date.now()) throw new EvmSendError("expired");
    await assertNoPendingWalletOperation(userId);
    const signer = await walletSigner(userId, password), reader = sendClient();
    if (signer.address !== getAddress(row.sender_address)) throw new EvmSendError("quote");
    const prepared = await reader.prepare(signer, row.payload);
    await transaction(async () => {
      const current = await db().one<SendRow>("SELECT * FROM evm_sends WHERE id = $1 FOR UPDATE", id);
      if (current?.status !== "quoted") throw new EvmSendError("quote");
      await db().execute(`UPDATE evm_sends SET status = 'pending',request_key = $1,raw_transaction = $2,transaction_hash = $3,updated_at = $4 WHERE id = $5`,
        requestKey, prepared.raw, prepared.hash, new Date().toISOString(), id);
    });
    return reconcileEvmSend((await db().one<SendRow>("SELECT * FROM evm_sends WHERE id = $1", id))!);
  });
}
async function reconcileEvmSend(row: SendRow): Promise<SendRow> {
  if (row.status !== "pending") return row;
  const reader = sendClient();
  // Never replace an indeterminate send with a new nonce or new signed bytes.
  try { await reader.broadcast(row.raw_transaction!, row.payload); } catch { /* Receipt lookup still works after an RPC timeout. */ }
  let result;
  try { result = await reader.verify(row.transaction_hash!, row.payload); } catch { return row; }
  if (!result) return row;
  await db().execute(`UPDATE evm_sends SET status = $1,block_number = $2,block_hash = $3,updated_at = $4 WHERE id = $5 AND status = 'pending'`,
    result.status, result.receipt.blockNumber, result.receipt.blockHash, new Date().toISOString(), row.id);
  return (await db().one<SendRow>("SELECT * FROM evm_sends WHERE id = $1", row.id))!;
}
export async function userEvmSends(userId: string) {
  const pending = await db().one<SendRow>("SELECT * FROM evm_sends WHERE user_id = $1 AND status = 'pending'", userId);
  if (pending) { try { await reconcileEvmSend(pending); } catch { /* Keep history readable while RPC is unavailable. */ } }
  return (await db().all<SendRow>("SELECT * FROM evm_sends WHERE user_id = $1 AND status <> 'quoted' ORDER BY created_at DESC LIMIT 20", userId)).map(sendStatus);
}
let sweeping = false;
export async function reconcilePendingEvmSends() {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const row of await db().all<SendRow>("SELECT * FROM evm_sends WHERE status = 'pending' ORDER BY created_at LIMIT 10")) {
      try { await reconcileEvmSend(row); } catch { /* Retry with the same signed transaction next pass. */ }
    }
  } finally { sweeping = false; }
}
export function evmSendError(error: unknown): never {
  if (typeof error === "object" && error && "statusCode" in error) throw error;
  const messages: Record<string, string> = {
    recipient: "Enter a valid recipient address different from your wallet and the token contract.",
    amount: "Enter a positive amount within this asset's decimal precision.", asset: "Choose POL or the configured token.",
    token: "The wallet token is not configured or unavailable.", balance: "Your token balance is too low for this transfer.",
    gas: "Keep enough POL for the amount and maximum gas fee.", expired: "This send quote expired or fees changed. Review the transfer again.",
    quote: "This send quote is unavailable. Review the transfer again.", rejected: "The token rejected this transfer.",
  };
  const message = error instanceof EvmSendError ? messages[error.message] : undefined;
  throw createError({ statusCode: message ? 409 : 503, statusMessage: message || "The send request could not be completed. Check recent sends before trying again." });
}
