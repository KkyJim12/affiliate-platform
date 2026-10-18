# UNXO API

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
| POST | `/api/auth/register` | Create an account and wallet; optional activated sponsor code |
| POST | `/api/auth/login` | Sign in with username and password |
| GET | `/api/auth/session` | Current account or `null` |
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
| GET | `/api/referrals/program` | Own activation status, code and sponsor |
| POST | `/api/referrals/activate` | Pay the one-time 10 USDT activation fee |
| POST | `/api/referrals/sponsor` | Connect the current account to an activated sponsor code |
| GET | `/api/explorer/network` | Inspect an authorized referral branch |
| GET | `/api/explorer/transactions` | Search and paginate the current account's ledger |
| GET | `/api/platform-settings` | Registration/funding availability and support email |
| POST | `/api/admin/login` | Sign in as an active administrator |
| GET | `/api/admin/overview` | Platform totals and recent activity |
| GET | `/api/admin/users` | Search and paginate accounts |
| PATCH | `/api/admin/users/:id` | Suspend/reactivate a member and revoke suspended sessions |
| GET | `/api/admin/payments` | Search funding requests and settlements |
| POST | `/api/admin/payments/:id` | Approve or reject a funding request |
| GET, PUT | `/api/admin/settings` | Read/update operational settings |
| GET | `/api/admin/explorer/network` | Inspect any account's referral branch |
| GET | `/api/admin/explorer/transactions` | Search ledger records across wallets |

Ownership always comes from the session, never a client-provided account or wallet
ID. Admin endpoints require an active administrator session. Anonymous requests
to protected endpoints return 401; member access to admin endpoints returns 403.
Validation and state conflicts use 400/409, and throttled requests use 429.

## Polygon Amoy account wallet

Registration atomically creates the user, internal ledger wallet and a random
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
credits and labels them separately; EVM-funded activation is not connected.

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

## Referral activation and sponsor linking

Activation request:

```json
{"password":"your-account-password","requestKey":"a-client-generated-UUID"}
```

Sponsor request:

```json
{"code":"LOOP-XXXXXXXX"}
```

Both return `{ user, wallet, program }`. Activation debits exactly 10 USDT of
available funds, records one `referral_purchase`, and generates the code in one
transaction. An already activated account returns the existing activation without
another charge, including retries with a different request key. Sponsor linking
is free, can happen before activation, and cannot replace an established sponsor.
Own codes, unavailable/suspended sponsors, and cycles at any depth are rejected.

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
15 levels. Transaction Explorer accepts `search`, `type`, `status`, `period`
(`all`, `7`, `30`, `90`) and `page`. Transaction types include `referral_purchase`;
statuses are `completed`, `pending`, and `rejected`. Search returns paginated
items and totals across all matching records.

Public visitors see labeled sample data. Rank projections and matrix illustrations
remain separate from actual wallet receipts. This API does not invent matrix
placement, automatic payouts, recycling, or upgrade rules.
