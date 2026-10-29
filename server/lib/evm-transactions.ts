import { formatUnits, getAddress, maxUint256 } from "viem";
import { evmAddress } from "../../shared/evm.ts";
import { polygonNetwork } from "../../shared/evm-wallet.ts";
import type { EvmTransaction, EvmTransactionHistory } from "../../shared/evm-transactions.ts";

const historyLimit = 50;
type HistoryInput = { explorerApiKey: string; chainId: string | number; tokenAddress: string };
type ProviderRow = Record<string, unknown>;
type Request = (url: URL, init: RequestInit) => Promise<Response>;

function integer(value: unknown, maxLength = 20): string {
  if (typeof value !== "string" || !/^\d+$/.test(value) || value.length > maxLength)
    throw new Error("Invalid explorer integer.");
  return value;
}
function address(value: unknown, nullable = false): string | null {
  if (nullable && value === "") return null;
  if (typeof value !== "string") throw new Error("Invalid explorer address.");
  // Mint/burn events legitimately contain the zero address.
  return getAddress(value);
}
function parseRow(row: ProviderRow, kind: EvmTransaction["kind"], owner: string, index: number, tokenAddress: string | null, network: ReturnType<typeof polygonNetwork>): EvmTransaction {
  if (typeof row.hash !== "string" || !/^0x[\da-fA-F]{64}$/.test(row.hash)) throw new Error("Invalid transaction hash.");
  const from = address(row.from)!;
  const to = address(row.to, kind === "native");
  const sent = from.toLowerCase() === owner.toLowerCase(), received = to?.toLowerCase() === owner.toLowerCase();
  if (!sent && !received) throw new Error("Explorer returned another wallet's transaction.");
  const contract = kind === "erc20" ? address(row.contractAddress)! : null;
  if (tokenAddress && contract && contract.toLowerCase() !== tokenAddress.toLowerCase()) throw new Error("Unexpected token contract.");
  const units = BigInt(integer(row.value, 78));
  if (units > maxUint256) throw new Error("Invalid transaction amount.");
  const decimals = kind === "native" ? 18 : Number(integer(row.tokenDecimal, 3));
  if (decimals > 255) throw new Error("Invalid token precision.");
  const symbol = kind === "native" ? network.currency : row.tokenSymbol;
  if (typeof symbol !== "string" || !symbol.trim() || symbol.length > 32 || /\p{C}/u.test(symbol)) throw new Error("Invalid token symbol.");
  const milliseconds = Number(integer(row.timeStamp, 11)) * 1000;
  const timestamp = new Date(milliseconds).toISOString();
  if (kind === "native" && (typeof row.isError !== "string" || typeof row.txreceipt_status !== "string"
    || !["0", "1"].includes(row.isError) || !["0", "1"].includes(row.txreceipt_status)))
    throw new Error("Invalid transaction status.");
  return { id: `${kind}:${row.hash}:${index}`, hash: row.hash.toLowerCase(), from, to,
    direction: sent && received ? "self" : sent ? "sent" : "received", kind,
    action: kind === "native" && !to ? "contractCreation" : kind === "native" && typeof row.input === "string" && row.input !== "0x" ? "contractCall" : "transfer",
    status: kind === "native" && (row.isError === "1" || row.txreceipt_status === "0") ? "failed" : "confirmed",
    amount: formatUnits(units, decimals), symbol, tokenAddress: contract, timestamp,
    blockNumber: integer(row.blockNumber), transactionIndex: integer(row.transactionIndex),
    explorerUrl: `${network.explorerUrl}/tx/${row.hash.toLowerCase()}` };
}

/** Indexed display history only: no signing, crediting, or proof of settlement. */
export function createWalletHistoryReader(input: HistoryInput, request: Request = fetch) {
  if (!input.explorerApiKey.trim()) throw new Error("Wallet history is not configured.");
  const network = polygonNetwork(input.chainId);
  const tokenAddress = input.tokenAddress ? evmAddress(input.tokenAddress) : null;
  return async (owner: string): Promise<EvmTransactionHistory> => {
    const ownerAddress = evmAddress(owner);
    async function read(kind: EvmTransaction["kind"]) {
      const url = new URL("https://api.etherscan.io/v2/api");
      url.search = new URLSearchParams({ chainid: String(network.chainId), module: "account",
        action: kind === "native" ? "txlist" : "tokentx", address: ownerAddress,
        startblock: "0", endblock: "999999999", page: "1", offset: String(historyLimit), sort: "desc", apikey: input.explorerApiKey.trim() }).toString();
      if (kind === "erc20" && tokenAddress) url.searchParams.set("contractaddress", tokenAddress);
      const response = await request(url, { signal: AbortSignal.timeout(10_000), redirect: "error", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Explorer request failed.");
      const payload = await response.json() as { status?: unknown; message?: unknown; result?: unknown };
      if (payload?.status === "0" && payload.message === "No transactions found" && Array.isArray(payload.result) && payload.result.length === 0) return [];
      if (payload?.status !== "1" || !Array.isArray(payload.result) || payload.result.length > historyLimit)
        throw new Error("Explorer history is unavailable.");
      return payload.result.map((row: unknown, index: number) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid explorer transaction.");
        return parseRow(row as ProviderRow, kind, ownerAddress, index, tokenAddress, network);
      });
    }
    const [native, token] = await Promise.all([read("native"), read("erc20")]);
    const transactions = [...native, ...token].sort((a, b) => {
      const block = BigInt(b.blockNumber) - BigInt(a.blockNumber);
      if (block) return block > 0n ? 1 : -1;
      const index = BigInt(b.transactionIndex) - BigInt(a.transactionIndex);
      return index === 0n ? 0 : index > 0n ? 1 : -1;
    }).slice(0, historyLimit);
    return { address: ownerAddress, chainId: network.chainId, transactions, limit: historyLimit };
  };
}
