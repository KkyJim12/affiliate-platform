# EVM smart contract integration and function analysis

Viem is the project's TypeScript EVM library. It fits Nuxt's ESM setup and
provides typed ERC-20 calls, ABI encoding/decoding and transaction inspection.
The initial integration supplies server-side read helpers. No contract address
or ABI for a deployed UNXO contract was provided, and the repository has no
Solidity contracts. The custom functions below are design proposals.

## Configuration and use

Copy the five `NUXT_EVM_*` entries from [`.env.example`](../.env.example) into
your local environment and supply an RPC URL, chain ID, token contract, treasury
address and positive minimum confirmation count. All five are required when
using the reader. Supported chain definitions are Ethereum (1), BNB Chain (56),
Polygon (137) and Sepolia (11155111). Extend `supportedEvmChains` in
[`server/lib/evm.ts`](../server/lib/evm.ts) for another EVM network.

Choose the actual token contract for that chain; an asset symbol does not
identify a token. The helpers read `decimals()` instead of assuming that every
USDT deployment uses the ledger's six decimal places. `symbol()` is optional;
missing `decimals()` fails the read rather than guessing precision.
ERC-20 defines these metadata methods as optional. [ERC-20 standard](https://eips.ethereum.org/EIPS/eip-20)

These settings live in private Nuxt runtime configuration. Leave all five blank
to continue using the application without a blockchain connection. The reader
is created only when called and does not require a signing key. Production
Node deployments must supply environment variables to the running server.
Nitro targets ES2022 to preserve BigInt amount arithmetic on the project's
required Node.js 24 or later runtime.

Inside server code:

```ts
import { evmReader } from "../utils/evm"; // adjust to the importing file

const reader = evmReader();
const token = await reader.readToken(ownerAddress);
// { chainId, tokenAddress, ownerAddress, blockNumber, decimals, symbol,
//   balanceUnits: "12345678000000000000", balance: "12.345678" }

const allowance = await reader.readAllowance(ownerAddress, spenderAddress);

const evidence = await reader.inspectTransfer({
  hash: transactionHash,
  logIndex: transferLogIndex,
  senderAddress: independentlyEstablishedSenderAddress,
  amount: "12.345678", // expected USDT amount from the funding request
});
// evidence.ledgerAmount === 12345678 (integer millionths)
// evidence.settlementReference === "evm:<chainId>:<hash>:<logIndex>"
```

These are internal helpers, with no new HTTP endpoint or member UI. The funding
and administrator APIs still require the existing manual settlement review.
Results use strings for blockchain integers, so they can be serialized to JSON.
The optional transport parameter on `createEvmReader` supports offline RPC tests.

## Functions available now

| Helper / contract function | Use in this project | Behavior |
| --- | --- | --- |
| `readToken(owner)` / `decimals()`, `symbol()`, `balanceOf(owner)` | Inspect a member's external token balance or the treasury's token holdings | Reads at one block; external balance stays separate from `wallets.available` |
| `readAllowance(owner, spender)` / `allowance(owner, spender)` | Check authorization before a future deposit contract pulls tokens | Returns integer token units; approval is not proof of payment |
| `inspectTransfer(expectation)` / `Transfer(from, to, value)` | Gather evidence for a specific funding request | Requires successful receipt, matching RPC chain, canonical receipt block, configured confirmations and an exact event match |
| `evmAddress(value)` | Validate external addresses | Rejects zero addresses, invalid checksums and internal `LW-*` IDs |
| `parseTokenAmount(value, decimals)` | Convert user input for contract calls | Accepts unsigned decimal strings; rejects excess precision and uint256 overflow |
| `tokenUnitsToLedger(units, decimals)` | Convert a token receipt to ledger millionths | Rejects fractional ledger units and unsafe integer values |
| `ledgerUnitsToToken(units, decimals)` | Prepare a future token amount from the ledger | Requires an exact conversion and valid integer ledger amount |

Viem's [`readContract`](https://viem.sh/docs/contract/readContract) performs
read-only ABI calls. [`parseEventLogs`](https://viem.sh/docs/contract/parseEventLogs)
decodes the selected receipt event with strict ABI matching. Each operation
checks the RPC's actual chain ID. Token and allowance snapshots pin their calls
to one block; receipt precision is read at the payment block. The RPC provider
must serve state at those blocks.

## Mapping existing application functions

| Current code | Contract integration point | Assessment |
| --- | --- | --- |
| `server/api/wallet/deposit.post.ts` | Bind a pending funding request to an external payment | Best first integration; request creation must still leave funds pending |
| `server/api/admin/payments/[id].post.ts` | Use inspected receipt evidence during approval | Existing row locks, atomic credit, review and audit are useful; automatic credit needs durable event ownership and consumption records first |
| `server/api/wallet/transfer.post.ts` | Optional future token withdrawal or external transfer | Current transfers are between internal accounts. A token transaction has a separate pending/confirmed lifecycle and needs a signer and wallet-address ownership model |
| `server/api/referrals/activate.post.ts` | Possible `activateReferral` contract operation | Currently debits 10 USDT from the ledger once. Decide which system collects the fee before introducing an on-chain payment, so one activation cannot charge twice |
| `server/api/referrals/sponsor.post.ts` | Possible immutable sponsor registration | Preserve the existing sponsor, self-referral and cycle rules. Wallet addresses need authenticated account links before becoming sponsor identities |
| `shared/plan.ts` | Possible future rank and commission contract math | Projection code only. Binary placement, qualification, missing-upline allocation, rounding, recycling and upgrade rules need a complete specification before any payout implementation |
| `server/utils/explorer.ts` | Include confirmed on-chain receipts in transaction details | Persist chain ID, token, hash, event index and block hash separately from internal ledger IDs |

## Functions for a later transaction workflow

| Viem / ERC-20 function | Intended use | Prerequisite |
| --- | --- | --- |
| `simulateContract` | Preflight a token transfer, approval or custom contract call | Exact deployed ABI, contract address and sending account; simulation does not reserve funds or guarantee a later execution |
| `writeContract` + `transfer(to, value)` | Send tokens from an external signing account | Wallet authorization or an explicit server custody design; receipt confirmation before settlement |
| `approve(spender, value)` + `transferFrom(from, to, value)` | Authorize and execute deposits through a contract | Confirm the approval before the pull; apply the selected token's allowance behavior |
| `waitForTransactionReceipt` | Track an initiated transaction | Persist the intended operation and transaction hash so server restarts and retries remain recoverable |
| `getLogs` / `watchContractEvent` | Reconcile deposits and payout events | Durable block checkpoints, bounded queries, event uniqueness and reorg handling; a live watcher alone is insufficient |
| `verifyMessage` / typed-data verification | Prove a member controls an external address | Server-issued nonce, account binding, domain, chain and expiration; a submitted address or hash alone proves no ownership |

Viem recommends pairing writes with simulation; writes require a wallet client.
[Simulation](https://viem.sh/docs/contract/simulateContract),
[contract writes](https://viem.sh/docs/contract/writeContract).
For a future Solidity deposit/payout contract, consider OpenZeppelin `SafeERC20`
for tokens with differing return-value behavior and `forceApprove` where
zero-first allowances are required. `permit` support must be checked against
the actual token implementation.
[OpenZeppelin ERC-20 utilities](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20#SafeERC20),
[ERC-2612](https://eips.ethereum.org/EIPS/eip-2612).

Potential custom interfaces are `deposit(amount, intentId)` with an emitted
deposit intent, `activateReferral(sponsor, intentId)` with one activation per
linked identity, and `claimCommission(epoch, amount, proof)` with replay
protection. These are proposed interfaces, not available methods. A rank
purchase or automatic recycle function should wait for the missing plan rules.

## What transfer evidence establishes

`inspectTransfer` selects exactly one nonremoved `Transfer` log emitted by the
configured token at the requested transaction-wide log index. It checks sender,
treasury, positive expected amount, successful execution, the canonical block
hash at inspection time and the configured confirmation threshold. It rejects
treasury self-transfers. It neither claims nor credits the event in PostgreSQL.
Confirmations describe the current chain view; later reorgs require reconciliation.

A public transaction hash can be copied by another account. Before automated
funding, establish who owns the payment through a verified account/wallet link,
an account-specific deposit address, or a contract event containing a validated
deposit intent. The caller-supplied `senderAddress` in this helper is only an
expectation; it does not authenticate the requesting member.

Store and atomically consume `(chain_id, transaction_hash, log_index)` with the
funding request, block hash, token, amount and audit record in a new additive
migration. The helper's deterministic reference fits existing manual settlement
references, but a free-text reference alone cannot enforce event uniqueness
against alternative reference formats. Avoid double credit between manual and
automatic review paths. Define a finality/reorg policy and reserve/debit/retry
states before implementing withdrawals. These helpers assume a configured,
trusted conventional ERC-20 token; fee-on-transfer or rebasing assets need
additional settlement accounting.

## Validation

```sh
npm run test:contracts
npm run typecheck
npm run build
```

Contract tests run locally through Viem's custom transport with encoded RPC
fixtures. They cover precision, overflow, configuration, read snapshots,
serialization, confirmation boundaries, malformed events, and mismatched or
reorganized transfers. They require no funded wallet, RPC credentials or database.
Live network behavior requires an explicitly configured RPC and token.
