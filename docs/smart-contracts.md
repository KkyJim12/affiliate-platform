# EVM smart contract integration and function analysis

Viem handles contract reads; Ethers generates and encrypts account wallets.
Viem fits Nuxt's ESM setup and
provides typed ERC-20 calls, ABI encoding/decoding and transaction inspection.
The initial integration supplies server-side read helpers. No contract address
or ABI for a deployed UNXO contract was provided, and the repository has no
Solidity contracts. The custom functions below are design proposals.

## Configuration and use

Copy the five `NUXT_EVM_*` entries from [`.env.example`](../.env.example) into
your local environment and supply an RPC URL, chain ID, token contract, treasury
address and positive minimum confirmation count. All five are required when
using the reader. Supported chain definitions are Ethereum (1), BNB Chain (56),
Polygon (137), Polygon Amoy (80002) and Sepolia (11155111). Extend `supportedEvmChains` in
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

These contract-reading helpers are internal. Account-wallet endpoints and their
UI are described below; funding still requires the existing manual settlement review.
Results use strings for blockchain integers, so they can be serialized to JSON.
The optional transport parameter on `createEvmReader` supports offline RPC tests.

## Polygon Amoy account wallets

Every new member account and CLI-created administrator receives a random Ethers
wallet in the same PostgreSQL transaction as its account and ledger wallet.
Wallet generation is offline, so registration does not depend on an RPC server.
Existing accounts receive a wallet after a successful password sign-in, or by
confirming their password on the wallet page. Concurrent provisioning keeps one
wallet; successful logins and retries preserve its address and encrypted key.

The network is fixed to [Polygon Amoy](https://docs.polygon.technology/tools/dApp-development/common-tools/remix/):
chain ID `80002`, test `POL`, RPC `https://rpc-amoy.polygon.technology/` and
explorer `https://amoy.polygonscan.com`. EVM keys themselves work across EVM
networks; the account record and UI designate this wallet for Amoy test assets.
Creating an address does not deploy a contract or allocate test tokens.

`evm_wallets` stores the owning user ID, unique checksummed address, uncompressed
public key, encrypted JSON keystore, fixed chain ID and creation time. It stores
no plaintext private key or mnemonic. The Ethers V3 keystore uses random salt/IV,
scrypt (`N=131072`, `r=8`, `p=1`), AES-128-CTR and its standard integrity MAC.
The encryption password is the member's account password; password hashing for
authentication remains separate. No shared encryption secret is stored in `.env`.
[Ethers wallet encryption](https://docs.ethers.org/v6/api/wallet/)

The member wallet page shows address/public key and an Amoy explorer link. An
authenticated, same-origin POST checks the current password before decrypting
the owner's key. A normal GET never reads the encrypted keystore column. Key
reveal is rate limited, not cached, never sent through SSR, and cleared from the
component on dismissal, account changes, navigation, hidden tabs or after
30 seconds. Strings cannot be securely erased from JavaScript memory; clearing
the references and UI bounds the exposure rather than guaranteeing memory erasure.
The Copy action explicitly places the revealed key on the user's clipboard.

Back up PostgreSQL, including `evm_wallets`, to preserve the encrypted keys.
There is no recovery mechanism for a forgotten encryption password. Any future
password-change feature must decrypt with the old password and re-encrypt with
the new password atomically; changing only `password_hash` would orphan the key.
The server handles plaintext passwords and keys briefly during these operations;
use HTTPS for deployment. This implements testnet key storage/reveal, with
signing, transfers and automated funding still requiring their own workflows.

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
| `server/api/wallet/transfer.post.ts` | Optional future token withdrawal or external transfer | Current transfers are between internal accounts. External token transfers need password-unlocked signing, ledger reservations and a pending/confirmed lifecycle |
| `server/api/referrals/activate.post.ts` | Possible `activateReferral` contract operation | Currently debits 10 USDT from the ledger once. Decide which system collects the fee before introducing an on-chain payment, so one activation cannot charge twice |
| `server/api/referrals/sponsor.post.ts` | Possible immutable sponsor registration | Preserve the existing sponsor, self-referral and cycle rules. Resolve generated wallet ownership from the account record before using addresses as on-chain identities |
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
expectation; it does not authenticate the requesting member. For generated
account wallets, resolve the expected sender from the session owner's
`evm_wallets` row instead of accepting an arbitrary address from the browser.

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
