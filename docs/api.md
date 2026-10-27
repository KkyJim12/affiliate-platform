# UNXO API

For the complete current inventory of all 52 method/route combinations, access and mode checks, request formats and rate limits, see the [English API reference](en/api-reference.md) or [คู่มือ API ภาษาไทย](th/api-reference.md). The [bilingual documentation index](README.md) also covers payments, conditions and operations. The integration notes below retain additional legacy context.

Connected wallets are now the default for members: wallet signatures for login and every on-chain write, with 1% bonuses at each of 15 depths. See [connected wallet setup, existing-account linking and distributor replacement](connected-wallets.md). In-app key management and password-authorized transactions below apply only when `NUXT_PUBLIC_WALLET_MODE=embedded` is explicitly enabled.

The member and administrator interfaces use the same-origin Nuxt API under `/api`.
The API stores all account and ledger data in PostgreSQL through `DATABASE_URL`.
Schema migrations run before the server starts accepting requests; CLI migration
and SQLite import commands are documented in [the README](../README.md#database-migrations).
Use the browser session cookie returned by login or registration. Session cookies
are HttpOnly and SameSite=Strict; HTTPS enables Secure. Every POST, PUT and PATCH
requires an `Origin` header matching the application origin. Responses are private
and must not be cached by a shared proxy. Authentication and financial writes are
rate limited.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Legacy account and wallet creation; requires embedded mode and password login enabled |
| POST | `/api/auth/login` | Legacy username/password login; requires `NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED=true` |
| GET | `/api/auth/session` | Current account or `null` |
| PATCH | `/api/auth/profile` | Rename the current account using `{ username }`; authenticated, same-origin and rate limited |
| POST | `/api/auth/logout` | Revoke the current session |
| GET | `/api/dashboard` | Own completed commissions, pending funding, transfer count and referral totals |
| GET | `/api/wallet` | Historic ledger balance and recent transactions (compatibility) |
| GET | `/api/wallet/evm` | Own Polygon Amoy address, public key and network metadata; no secrets |
| GET | `/api/wallet/evm/balance` | Own native POL and optionally configured ERC-20 on-chain balances |
| GET | `/api/wallet/evm/transactions` | Own latest indexed Amoy transactions and ERC-20 transfers |
| POST | `/api/wallet/evm` | Password-confirmed, idempotent wallet creation for an existing account |
| POST | `/api/wallet/evm/reveal` | Password-confirmed private key reveal for the session owner |
| POST | `/api/wallet/deposit` | Submit a funding request; does not credit the balance |
| POST | `/api/wallet/transfer` | Password-confirmed transfer to another active member |
| GET | `/api/referrals` | Own direct members and referral tree |
| GET | `/api/referrals/tree?id=1&path=0/1&levels=3` | Public actual sponsor tree by numeric member ID; no session required |
| GET | `/api/referrals/program` | Own activation status, code and sponsor |
| POST | `/api/referrals/activate` | Pay the one-time 10 USDT activation fee |
| POST | `/api/referrals/upgrade` | Purchase the next level, through level 15 |
| POST | `/api/referrals/sponsor` | Connect the current account to an activated sponsor code |
| GET | `/api/explorer/network` | Inspect an authorized referral branch |
| GET | `/api/explorer/transactions` | Search and paginate the current account's ledger |
| GET | `/api/platform/transactions` | Public DB-recorded transactions for the configured referral contract |
| GET | `/api/platform/analytics` | Public aggregate account, purchase, distribution and activity statistics |
| GET | `/api/platform-settings` | Registration/funding availability and support email |
| POST | `/api/admin/login` | Administrator username/password login; always available, including for linked wallets |
| GET | `/api/admin/overview` | Platform totals and recent activity |
| GET | `/api/admin/users` | Search and paginate accounts |
| PATCH | `/api/admin/users/:id` | Rename an account using `{ username }` and/or suspend/reactivate a member using `{ status }`; changes commit atomically |
| GET | `/api/admin/payments` | Search funding requests and settlements |
| POST | `/api/admin/payments/:id` | Approve or reject a funding request |
| GET, PUT | `/api/admin/settings` | Read/update operational settings |
| GET | `/api/admin/referral-accounting` | Upline credits and platform amounts awaiting settlement, grouped by address |
| GET | `/api/admin/explorer/network` | Inspect any account's referral branch |
| GET | `/api/admin/explorer/transactions` | Search ledger records across wallets |

Ownership always comes from the session, never a client-provided account or wallet
ID. Admin endpoints require an active administrator session. Anonymous requests
to protected endpoints return 401; member access to admin endpoints returns 403.
Validation and state conflicts use 400/409, and throttled requests use 429.

## Public platform activity

`GET /api/platform/transactions` backs the member and administrator Explorer transaction tab. It requires no login and returns public hashes, wallet addresses, purchase levels/amounts, status, block numbers when recorded and Amoy explorer links. It merges `referral_chain_purchases`, `referral_chain_fee_updates` and external-wallet fee operations, deduplicates hashes, and limits results to `NUXT_REFERRAL_CONTRACT_ADDRESS`. Unsigned quotes, unrelated wallet sends, private ledger records and signing payloads are excluded. Direct calls made outside the platform are not indexed by this endpoint.

Query parameters are `search` (hash or address, case insensitive), `kind` (`all`, `purchase`, `fee_update`), `status` (`all`, `pending`, `confirmed`, `failed`), `period` (`all`, `7`, `30`, `90` days) and `page` (one based). The response has `{ configured, contractAddress, chainId, items, total, page, pageSize, summary }`, with 12 items per page. Summary counts and confirmed purchase volume apply to the selected filters. Amounts use USDT units; fees are not purchase volume. Missing contract configuration returns an empty response with `configured: false`.

`GET /api/platform/analytics` backs FAQ → Analytics. It returns `{ configured, contractAddress, chainId, updatedAt, accounts, activeMembers, buyers, purchases, transactions, volume, distributions, daily, levels }`. Accounts includes all registered accounts; activeMembers excludes suspended users and administrators. Buyers counts distinct wallet addresses with a confirmed purchase. Purchase totals, volume and direct/bonus/platform distributions include only confirmed records for the configured contract. Transactions also includes confirmed fee updates. `daily` contains 30 calendar days using Asia/Bangkok boundaries, with registrations, purchases and volume; `levels` contains all 15 levels. No account identities or private balances are exposed. These are testnet token units.

## Polygon Amoy account wallet

In embedded mode, registration atomically creates the user, internal ledger wallet and a random
Ethers wallet pinned to Polygon Amoy (chain ID `80002`). Existing members and
administrators get a wallet on their next successful password sign-in. An older
active session can provision one with `POST /api/wallet/evm`. Existing keys are
never replaced by login or provisioning retries.

`GET /api/wallet/evm` returns `{ wallet }`; the value is `null` for an account
that has not yet been provisioned. Public details include `address`, `publicKey`,
`chainId`, `network`, `currency`, `testnet`, `explorerUrl` and `createdAt`.
The private key and encrypted keystore are excluded from normal account/wallet
responses and SSR data.

`GET /api/wallet/evm/balance` returns `{ address, chainId, blockNumber, native,
token }` for the session owner's address. Assets include `symbol`, `decimals`,
`balanceUnits` and `balance`; blockchain integers and decimal balances are strings.
`token` is `null` without an Amoy token contract configured. It accepts no owner
address from the browser. Reads check chain ID `80002` and pin one block. Missing
wallets return 404; RPC/configuration/token-read failures return 503 without
provider details. Reads are limited to 60 requests per account/IP per 15 minutes.
The member UI uses this endpoint exclusively for the displayed wallet balance.

Both POST endpoints accept `{ "password": "your-account-password" }`, require
the session owner and a matching Origin, and allow five attempts per account/IP
per 15 minutes independently for creation and reveal. Reveal returns
`{ privateKey }` only after checking the current account password and decrypting
the stored keystore. All API responses use `Cache-Control: no-store`; submitted
account IDs and wallet IDs never select the owner. Suspension/logout removes
access. The UI keeps the revealed key in local component memory and clears it
on closing, navigation, account changes, hidden tabs and after 30 seconds.

See [wallet encryption and lifecycle](smart-contracts.md#polygon-amoy-account-wallets)
for storage and recovery details. Amoy test assets are separate from the USDT
ledger; these endpoints do not transfer or fund tokens.

The old deposit/transfer APIs remain for historical integrations and operator
settlement. The member wallet no longer exposes internal funding, transfers,
ledger IDs or ledger balances. The referrals page can spend existing referral
credits only in explicit legacy ledger mode. Default contract purchases use the
configured Amoy token and distribute automatically; see [the contract API](referral-contract.md).

## EVM wallet sends

The Send action transfers native POL or `NUXT_EVM_TOKEN_ADDRESS` on Polygon Amoy.
It requires no referral activation, distributor contract, or quote authority key.
Native sends work without a configured token. Configuration uses `NUXT_EVM_RPC_URL`,
`NUXT_EVM_CHAIN_ID=80002`, and `NUXT_EVM_MIN_CONFIRMATIONS` (default 2).

- `POST /api/wallet/evm/send/quote` accepts `{ recipient, asset: "native" | "token", amount }`.
  Amount is a decimal string; excess precision, zero, self-transfers, zero addresses
  and the configured token contract as recipient are rejected. Returns `{ quote }`
  containing its single-use ID, review hash, amount, recipient, asset, maximum POL
  gas budget and five-minute expiry. Quoting does not sign or move funds.
- `POST /api/wallet/evm/send` accepts `{ id, quoteHash, requestKey, password }`.
  The current account password unlocks its encrypted wallet on the server. The
  exact reviewed transaction is rechecked and signed; its bytes and hash commit
  before broadcast. Returns `{ send }`, HTTP 202 while pending or 200 when settled.
  Retrying the same quote returns the same transfer even with a different request
  key. Reusing a request key for another quote returns 409.
- `GET /api/wallet/evm/sends` reconciles the owner's pending send and returns
  `{ sends }` with the latest 20 submitted sends, including transaction explorer
  links. Unsigned quotes, signed bytes and private keys are never returned.

All endpoints resolve the wallet from the active session and use `no-store`.
POST requests require a matching Origin. Quotes allow 40 attempts and send
confirmation allows 20 attempts per account/IP per 15 minutes. The UI clears
passwords on closing, leaving the tab, account changes and completion. Both
assets reserve POL for the reviewed maximum gas cost; the referral purchase
minimum balance does not apply to general sends.

Sends, purchases and admin fee updates share a database advisory lock and cannot
prepare a new transaction while that wallet has a pending operation. A background
worker retries the same signed bytes every 15 seconds even after closing the
browser or restarting the app. Confirmations require a canonical receipt and an
exact matching transaction; tokens additionally require the exact Transfer event.
Reverted receipts show failed and may charge gas. An unavailable RPC, dropped
transaction, unsupported token transfer behavior or external nonce replacement
stays pending for investigation rather than automatically issuing another send.
These transfers never credit or debit the historical internal ledger.

Validate with `npm run test:sends` and `npm run test:onchain`. Both use a disposable
local EVM; the latter also creates a disposable PostgreSQL database and exercises
real API signing, recovery and desktop/mobile send dialogs.

## EVM wallet transaction history

`GET /api/wallet/evm/transactions` resolves the wallet from the authenticated
session; client-supplied addresses/user IDs are ignored. It returns
`{ address, chainId, transactions, limit }` with at most 50 recent records.
Records contain a display ID, hash, from/to, direction (`sent`, `received`, `self`),
kind (`native`, `erc20`), action (`transfer`, `contractCall`, `contractCreation`),
status (`confirmed`, `failed`), exact decimal amount, symbol, token address,
ISO timestamp, block number, transaction index and a fixed Amoy explorer link.

Configure `NUXT_EVM_EXPLORER_API_KEY` with an Etherscan V2 key that can query
Amoy (`80002`). Optional `NUXT_EVM_TOKEN_ADDRESS` filters ERC-20 history; leaving
it blank includes all ERC-20 tokens. Native history uses `txlist` and token
history uses `tokentx`; each source supplies its latest 50 records, merged and
capped at 50. Native contract calls and token transfer events can share a hash.
Display IDs identify rows, not durable blockchain event IDs or settlement proof.
Internal native contract transfers and NFT activity are outside this panel's scope.

The endpoint never selects encrypted key columns or signs transactions. Missing
wallets return 404; missing credentials, invalid explorer records and provider
failures return a generic 503 instead of an empty list. Responses are not cached.
Reads are limited to 30 per account/IP per 15 minutes. History is an indexer view
and may lag the chain; it neither changes balances nor settles ledger payments.

## Legacy ledger activation and sponsor linking

The default payment mode is now `contract`. Use the chain purchase APIs described
in [smart-contract setup and recovery](referral-contract.md). The following
activation/upgrade endpoints only accept writes with explicit
`NUXT_REFERRAL_PAYMENT_MODE=ledger`.

Activation request:

```json
{"password":"your-account-password","requestKey":"a-client-generated-UUID"}
```

Sponsor request:

```json
{"code":"1"}
```

Both return `{ user, wallet, program }`. Activation debits exactly 10 USDT of
available funds, records one `referral_purchase`, and activates the member's numeric ID in one
transaction. An already activated account returns the existing activation without
another charge, including retries with a different request key. Sponsor linking
is free, can happen before activation, and cannot replace an established sponsor.
Own codes, unavailable/suspended sponsors, and cycles at any depth are rejected.

Member IDs are decimal strings starting at `1`, assigned consecutively at
registration. Account responses include `memberId` even before activation;
`referralCode` is that same ID after activation and otherwise `null`. Internal
`user.id` UUIDs remain unchanged. Previously shared `UNXO-` and `LOOP-` invites
continue to resolve to the same account through aliases.

`GET /api/referrals/tree?id=1` is public. It returns `root`, `path`, `maxDepth: 15`,
`visibleDepth`, sparse `members` with numeric `id`, `username`, `path`, `parentId`, and
`{depth,filled}` counts for all 15 descendant `levels`. The client fills missing
positions with empty boxes. `path` contains at most 15 sibling indices separated
by `/`, for example `0/2/1`; indices can exceed 1 and empty branches are valid.
`levels` defaults to 3 and accepts 1–15, clamped at the
15-level boundary. Invalid parameters return 400; an unknown numeric ID returns
404. No wallet data, internal UUIDs, timestamps, account status or credentials are
included. The endpoint traverses `users.sponsor_id`, keeping every direct referral
under the real sponsor, ordered by registration time and ID. Retained binary
placement tables are not used for this response; commission ancestry also follows
the original sponsor chain.

Upgrade request:

```json
{"password":"your-account-password","requestKey":"a-client-generated-UUID","level":2}
```

The server calculates `10 × 2^(level − 1)` USDT and only accepts the next level.
Levels 2, 3, 4 cost 20, 40, 80 USDT; level 15 costs 163,840 USDT.
Each price is paid in full, rather than charging the difference from the previous
level. The referral code stays unchanged. Repeating the same request key and level
returns the current state without charging or distributing again; reusing a key
for another level returns 409. Activation retains its original one-time behavior.

`program` includes `currentLevel` (0 before activation), `maxLevel`, `nextLevel`,
`nextPrice`, `feeConfigured`, and `latestPurchase` with amount, upline credits and
platform payable. At level 15 both next fields are null. Existing activations
remain level 1; historical payments do not receive retroactive distributions.

Every new activation and upgrade atomically debits the buyer and allocates 100%:

- 50%, 20%, 10% of the purchase to sponsor ancestors at depths 1, 2, 3.
- Exactly 1% at each bonus depth from 1 to 15. These overlap the direct shares.
  Unused trailing bonus shares pay the highest eligible upline. These bonuses overlap the direct shares for the first three uplines.
- 5% payable to the configured platform fee address.

Amounts use integer micro-USDT; each bonus is exactly 1% at every price. Each ancestor must have an activated
referral code, an active account and an internal wallet. Missing/ineligible direct shares
and bonus gaps below the highest eligible upline become payable to the platform
fee address, preserving their kind/depth and reason. Trailing bonus depths instead
credit the highest eligible upline. The system does not move another ancestor
into a missing direct position.

Admin settings accept `feeRecipientAddress` as a checksummed or lowercase nonzero
EVM address. Leaving it empty disables new purchases. Each purchase snapshots the
address, so changing it only affects future payments. Changes are audited.
`GET /api/admin/referral-accounting` returns `{ credited, payables }`; each payable
has `{ address, platformFees, redirectedShares, total }`, in USDT.

Upline commissions are completed **internal ledger credits**. Platform allocations
have `payable` status: they have **not** been sent on-chain. These endpoints do not
spend the account's EVM tokens or sign external transfers. The admin accounting
view labels this distinction explicitly.

Funding requests accept `{ amount, requestKey }`. Transfers accept
`{ amount, recipient, password, requestKey }`. Amounts are decimal strings with
up to six fractional digits. Generate one UUID per intended transaction and reuse
it if a request is retried. Balances and amounts in responses are USDT; storage
uses integer millionths.

## Dashboard and Explorer

`GET /api/dashboard` returns:

```json
{
  "commissions": 0,
  "directCommissions": 0,
  "bonusCommissions": 0,
  "pendingFunding": 0,
  "completedTransfers": 0,
  "referrals": {"direct": 0, "total": 0, "depth": 0, "truncated": false}
}
```

Completed commissions are aggregated from the full ledger, independent of the
200 recent records returned by the wallet endpoint. Pending funding excludes
reviewed/rejected requests. Referral totals cover up to 15 levels and cap the
returned count at 500; `truncated: true` makes the count a lower bound. Direct
referrals are counted separately without that cap.

Network Explorer accepts `root` (account ID); administrators may use an exact
`username` instead. Members can only open branches within their original first
15 levels. The legacy private ledger endpoints accept `search`, `type`, `status`, `period`
(`all`, `7`, `30`, `90`) and `page`. Transaction types include `referral_purchase`;
statuses are `completed`, `pending`, and `rejected`. Search returns paginated
items and totals across all matching records.

Public visitors see a labeled sample network and real recorded public contract activity. The current Transactions tab uses `/api/platform/transactions`, documented above. Rank projections and matrix illustrations
remain separate from actual wallet receipts. This API does not invent matrix
placement or recycling. Actual referral purchases use the allocation rules above.
