# UNXO API reference

[Documentation index](../README.md) · [ภาษาไทย](../th/api-reference.md) · [System](system-guide.md) · [Payments](payments-and-conditions.md) · [Operations](operations.md)

Reviewed **27 October 2026**, revision `3ffa828`. This catalog covers all **52 method/route combinations** under `server/api`, including retained compatibility endpoints. Bodies and examples describe the implementation, not an external payment gateway.

## 1. Shared protocol

- Base path: `/api`, same origin as the Nuxt application. JSON requests use `Content-Type: application/json`.
- Authentication: the `loop_session` browser cookie. It is HttpOnly, SameSite=Strict, seven days, with Secure on HTTPS. No API-key/bearer authentication is implemented here.
- POST/PUT/PATCH require an `Origin` exactly matching the request origin; cross-site fetches are rejected. Production wallet authentication also checks `NUXT_PUBLIC_APP_URL`.
- Every API response has `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- Middleware rejects a declared `Content-Length` above 8,192 bytes with 413. This is a header-based check, rather than a guarantee of a streamed-body size limit.
- Ownership comes from the session. A submitted account ID or wallet ID cannot select another owner; admin network/list routes have their explicitly authorized wider scope.
- Use a UUID `requestKey` per intended financial operation and reuse it when retrying. The validator accepts 36 hexadecimal/hyphen characters. Different operations must use different keys; do not rely on changing the payload of an existing key.
- Legacy amounts are decimal strings with up to six decimal places, 0.01–999,999,999. On-chain send amounts are positive strings within actual asset precision. On-chain raw units/balances are strings; ledger/reporting amounts are exposed in whole-token units as numbers.

Access notation below: **P** public/no session, **M** active signed-in account, **A** active administrator. Mode notation: **X** external wallet, **E** embedded wallet, **L** embedded plus explicit ledger payments, **C** password-login flag enabled. “Any” describes an endpoint without that mode restriction, including historical reads.

## 2. Authentication and public data — 12 routes

| Method | Endpoint | Access / mode | Input and result |
| --- | --- | --- | --- |
| GET | `/api/auth/session` | P / Any | `{ user: Account or null }` |
| POST | `/api/auth/wallet/challenge` | P for login, M for link / X | `{address,purpose?,sponsorCode?}` → `{id,message}`; purpose defaults to `login`, or `link`; five-minute challenge |
| POST | `/api/auth/wallet/verify` | Signature; M for link / X | `{id,signature}` → `{user}` and session cookie; creates an unknown member wallet account when registration is open |
| POST | `/api/auth/register` | P / E+C | `{username,password,sponsorCode?}` → `{user}`, HTTP 201 and session; creates credential account and encrypted embedded wallet |
| POST | `/api/auth/login` | P / C | `{username,password}` → `{user}` and session; external linked accounts must use wallet login |
| PATCH | `/api/auth/profile` | M / Any | `{username}` → `{user}`; rename without changing account identity |
| POST | `/api/auth/logout` | P / Any | No required body → `{success:true}`; revokes the supplied current session |
| POST | `/api/admin/login` | P, valid active admin credentials / Any | `{username,password}` → `{user}` and session; independent of member password-login flag |
| GET | `/api/platform-settings` | P / Any | `{registrationOpen,fundingOpen,supportEmail,feeRecipientAddress}` |
| GET | `/api/referrals/tree` | P / Any | Query `id`, `path?`, `levels?` → public sponsor tree |
| GET | `/api/platform/transactions` | P / Any | Public recorded activity for the configured distributor; filters below |
| GET | `/api/platform/analytics` | P / Any | Aggregate accounts, confirmed purchases/distributions and 30-day activity |

`Account` fields are `id` (internal UUID), `memberId` (numeric string), `username`, `referralCode` (null until activated), `sponsorCode`, `createdAt`, `role`. A public tree response does not expose the internal UUID. An admin cannot use a wallet login challenge to replace admin credential sign-in.

## 3. Member, wallet and connected transactions — 18 routes

| Method | Endpoint | Access / mode | Input and result |
| --- | --- | --- | --- |
| GET | `/api/dashboard` | M / Any | Commission breakdown, pending legacy funding, completed internal transfers and referral totals |
| GET | `/api/referrals` | M / Any | `{members,network,truncated}`; own direct registrations and up-to-15-level network, capped at 500 network members |
| GET | `/api/referrals/program` | M / Any | Activation/code/sponsor, current/next level, next price and legacy latest-purchase summary |
| POST | `/api/referrals/sponsor` | M / Any | `{code}` → `{user,wallet,program}`; attach an active activated sponsor once; pending purchases/cycles/self-links rejected |
| GET | `/api/referrals/chain/status` | M / Any | `ReferralChainStatus`; attempts reconciliation of the account's pending purchase |
| GET | `/api/referrals/chain/purchases` | M / Any | Array of latest twenty `ChainPurchaseStatus` items |
| POST | `/api/referrals/chain/prepare` | M / X | `{level,requestKey}` → `{id,status,calls}`; persist authorization and return unsigned approval/purchase calls |
| POST | `/api/referrals/chain/confirm` | M / X | `{id,transactionHash}` → `ChainPurchaseStatus`; validates the submitted purchase transaction |
| GET | `/api/wallet` | M / Any | Historical ledger `WalletSummary`, up to 200 recent transactions; not the current EVM token balance |
| GET | `/api/wallet/evm` | M / Any | `{wallet}` or `{wallet:null}`; selected-mode address/network details; external public key is null |
| GET | `/api/wallet/evm/balance` | M / Any | Own `{address,chainId,blockNumber,native,token}`; token may be null; pinned-block Amoy read |
| GET | `/api/wallet/evm/transactions` | M / Any | `{address,chainId,transactions,limit}`; at most fifty indexed native/ERC-20 records |
| GET | `/api/wallet/evm/sends` | M / Any | `{sends}`; latest twenty submitted embedded send records, with reconciliation; not the external-operation list |
| POST | `/api/wallet/connected/send` | M / X | `{asset,recipient,amount,requestKey}` → `ExternalOperation` with unsigned send call |
| POST | `/api/wallet/connected/confirm` | M / X | `{id,transactionHash}` → `ExternalOperation`; confirms an owned send or fee intent |
| GET | `/api/wallet/connected/operations` | M / Any | Latest twenty external send/fee operations with receipt reconciliation |
| GET | `/api/explorer/network` | M / Any | Query `root?` → authorized private sponsor branch |
| GET | `/api/explorer/transactions` | M / Any | Filter/paginate the account's historical ledger activity |

`GET /api/wallet/evm/balance` returns 404 for no wallet and 503 for failed RPC/config/token reads. Assets contain `symbol`, `decimals`, `balanceUnits`, `balance`; units and balances are strings. No owner address is accepted from the caller.

Indexed history contains hash/from/to, direction (`sent`,`received`,`self`), kind (`native`,`erc20`), action (`transfer`,`contractCall`,`contractCreation`), status, decimal amount, symbol/token address, ISO timestamp, block/transaction position and explorer URL. Missing explorer credentials or failed provider reads return 503; a valid empty list is a different outcome. Internal native transfers/NFTs are outside this panel.

## 4. Embedded and legacy payment writes — 9 routes

| Method | Endpoint | Access / mode | Body and result |
| --- | --- | --- | --- |
| POST | `/api/wallet/evm` | M / E | `{password}` → `{wallet}`; create a missing wallet idempotently |
| POST | `/api/wallet/evm/reveal` | M / E | `{password}` → `{privateKey}` after verifying password and decrypting keystore |
| POST | `/api/wallet/evm/send/quote` | M / E | `{recipient,asset,amount}` → `{quote}` with ID, review hash, gas budget and five-minute expiry |
| POST | `/api/wallet/evm/send` | M / E | `{id,quoteHash,requestKey,password}` → `{send}`; 202 while pending, otherwise 200 |
| POST | `/api/referrals/chain/purchase` | M / E, contract payment | `{password,level,requestKey}` → `ChainPurchaseStatus`; 202 while pending, otherwise 200 |
| POST | `/api/wallet/deposit` | M / E, funding open | `{amount,requestKey}` → `WalletSummary`; creates pending request without credit |
| POST | `/api/wallet/transfer` | M / E | `{amount,recipient,password,requestKey}` → `WalletSummary`; `recipient` is an active username |
| POST | `/api/referrals/activate` | M / L | `{password,requestKey}` → `{user,wallet,program}`; one-time level-1 legacy credit purchase |
| POST | `/api/referrals/upgrade` | M / L | `{password,requestKey,level}` → `{user,wallet,program}`; next legacy level 2–15 only |

Mode gates can be inside called utilities, not only route files. Existing active sessions do not remove password checks on sensitive embedded writes. The application clears a revealed embedded private key after thirty seconds and on close/navigation/hidden-tab/account changes; that key-reveal feature is blocked in external mode.

## 5. Administrator management — 13 routes

The public admin credential-login route is counted in section 2; every route below requires **A**.

| Method | Endpoint | Mode / further condition | Input and result |
| --- | --- | --- | --- |
| GET | `/api/admin/overview` | Any | Account totals, legacy balances/funding, seven UTC growth days, recent payments and audit |
| GET | `/api/admin/users` | Any | Query `page,search,status` → `{items,total,page,pageSize}` |
| PATCH | `/api/admin/users/:id` | Any | `{username? ,status?}` with at least one field; status `active`/`suspended` → `{ok:true}`; cannot suspend admin accounts |
| GET | `/api/admin/settings` | Any | `PlatformSettings` |
| PUT | `/api/admin/settings` | Any | `{registrationOpen,fundingOpen,supportEmail,feeRecipientAddress?}` → settings; chain-recipient changes prohibited here in contract mode |
| GET | `/api/admin/referrals/status` | Any | `{chain,canManageFee,feeUpdate,totals}`; reconciles chain operations; contract accounting totals may include older stored distributors |
| POST | `/api/admin/referrals/prepare-fee` | X + linked wallet is current owner | `{address,requestKey}` → unsigned fee `ExternalOperation`; wallet signs it, then use connected confirm |
| POST | `/api/admin/referrals/fee` | E + embedded wallet is owner | `{password,address,requestKey,maxGasFee}` → `{status,transactionHash}`; 202 pending; gas budget in decimal POL |
| GET | `/api/admin/referral-accounting` | Any, historical ledger | `{credited,payables}` grouped by legacy fee address; not proof of on-chain settlement |
| GET | `/api/admin/payments` | Any, historical funding | Query `page,search,status` → paginated funding requests and reviews |
| POST | `/api/admin/payments/:id` | Any, historical funding | `{decision,reference?,note?,verified?}` → `{ok:true}`; approve/reject under receipt-verification rules |
| GET | `/api/admin/explorer/network` | Any | Query `root?` or exact `username?` → any account's private branch |
| GET | `/api/admin/explorer/transactions` | Any | Search/filter/page ledger records across accounts |

Funding settlement APIs remain callable by authorized admins even though the payment-review page redirects to the dashboard. Approving requires `verified:true` and a unique 6–160 character reference. Rejection requires a note of 3–500 characters. Identical retries are idempotent. `supportEmail` may be empty; otherwise it must match the server's email-format check and fit 254 characters. A fee address must be a valid nonzero EVM address; chain fee preparation also rejects the distributor itself.

## 6. Query parameters and response shapes

### Public tree

```text
GET /api/referrals/tree?id=1&path=0/2&levels=3
```

`id` is a positive safe-integer numeric member string, up to sixteen digits. `path` is empty or sibling indices separated by `/`; indices may exceed 1, because all actual direct referrals stay beneath their sponsor. Each path segment accepts `0` or a positive integer up to nine digits, with at most fifteen segments. `levels` is an integer 1–15, default 3, clamped by the remaining tree depth.

Returns `{root,path,maxDepth:15,visibleDepth,members,levels}`. Members contain `{id,username,path,parentId}` with numeric public IDs. Each level count contains `{depth,filled}`. The endpoint does not return binary capacities, private wallet data or account status. Unknown ID: 404; malformed query: 400. Database binary placements are not the current endpoint's ancestry.

### Public activity and analytics

`/api/platform/transactions` parameters:

| Parameter | Accepted values |
| --- | --- |
| `search` | Case-insensitive hash/address search, trimmed to 100 characters |
| `kind` | `all`, `purchase`, `fee_update` |
| `status` | `all`, `pending`, `confirmed`, `failed` |
| `period` | `all`, `7`, `30`, `90` days |
| `page` | One-based, clamped 1–100000 |

Response: `{configured,contractAddress,chainId,items,total,page,pageSize:12,summary}`. Summary applies the selected filters; volume includes confirmed purchases only. Results include recorded purchase and fee-update hashes for the configured distributor, deduplicated by hash. They exclude unsigned quotes, private ledger rows, unrelated sends and unindexed calls made outside the platform.

`/api/platform/analytics` returns `{configured,contractAddress,chainId,updatedAt,accounts,activeMembers,buyers,purchases,transactions,volume,distributions,daily,levels}`. Contract statistics include confirmed records for the current distributor. Active members exclude suspended/admin accounts. `daily` covers thirty Asia/Bangkok calendar dates; `levels` covers 1–15. These are testnet token figures.

### Private explorers and lists

Private network query `root` is an internal account UUID. Members can inspect their own root or descendants within their original fifteen levels; unauthorized/missing branches return the same 404. Admins may use exact `username`. Results contain `{root,members,truncated,remainingDepth}`, with up to 500 members.

Ledger explorer query: `search`, `type`, `status`, `period`, `page`. Types: `all`, `deposit`, `withdrawal`, `transfer_in`, `transfer_out`, `commission`, `referral_purchase`. Statuses: `all`, `pending`, `completed`, `rejected`. Periods: `all`, `7`, `30`, `90`. Pagination uses twelve items and returns `{items,total,page,pageSize,summary}` with ledger credit/debit/pending totals. The `withdrawal` filter does not imply that a withdrawal creation endpoint exists.

Admin users/payments lists use `page`, `search` and `status`, twelve items per page; admin list search is trimmed to 64 characters. User status filters use `all`, `active`, `suspended`; payment filters use `all`, `pending`, `completed`, `rejected`.

### Key models

```typescript
type ChainPurchaseStatus = {
  id: string; level: number;
  status: 'awaiting_signature' | 'pending' | 'confirmed' | 'failed';
  transactionHash: string | null; explorerUrl: string | null;
};

type ReferralChainStatus = {
  mode: 'contract' | 'ledger'; configured: boolean; ready: boolean;
  chainId: number; contractAddress: string | null; tokenAddress: string | null;
  tokenSymbol: string | null; feeRecipient: string | null; owner: string | null;
  balance: string | null; gasBalance: string | null; gasBudget: string | null;
  currentLevel: number | null; pending: ChainPurchaseStatus | null; error?: string;
};
```

Normal purchase status reads do not check POL/gas estimates; gas fields are null. Embedded admin status can request gas details. `ready` does not guarantee enough funds or that a subsequent transaction will succeed.

An `ExternalOperation` has `id`, `kind` (`send`/`fee`), `status`, `transactionHash`, `call`, `recipient` and optional `amount`, `symbol`, `gasBudget`. Its unsigned call includes sender, target, calldata, value, chain ID and optional nonce. The connected prepare response is not a broadcast or settlement.

`WalletSummary` contains `id`, `currency`, `available`, `reserved`, `earned`, `transactions`. `ReferralProgram` contains `price`, `code`, `activatedAt`, `transactionId`, `currentLevel`, `maxLevel`, `nextLevel`, `nextPrice`, `feeConfigured`, `latestPurchase`, `sponsor`. The latest-purchase summary is historical ledger data; use chain purchase/status APIs for on-chain purchases.

## 7. Request examples and sequencing

Examples use placeholders for signatures, hashes and addresses. Replace them with the account's actual values; examples are not executable payment credentials.

Request a login challenge, sign its exact returned `message` in the chosen wallet, then verify:

```json
{"address":"<connected EVM address>","purpose":"login","sponsorCode":"1"}
```

```json
{"id":"<challenge ID>","signature":"<wallet signature>"}
```

After the session is established, prepare a next-level purchase:

```json
{"level":1,"requestKey":"e46f9527-450d-4b22-a087-ecb482c5aac1"}
```

Execute the returned calls in order from the linked wallet: optional allowance reset, exact approval, then purchase. After broadcasting the **purchase** call, submit its hash to `/api/referrals/chain/confirm`:

```json
{"id":"<prepared purchase ID>","transactionHash":"<purchase transaction hash>"}
```

Poll the chain status until verified. A wallet acknowledgment or an approval hash alone does not activate the code. Purchase recovery can also locate the signed ID on-chain; external transfer replacement discovery is not implemented.

To send, use `/api/wallet/connected/send`:

```json
{"asset":"token","recipient":"<recipient EVM address>","amount":"10.25","requestKey":"de826b7a-e238-4134-b43d-06820be97bf7"}
```

Have the wallet sign/broadcast the returned `call`, then send `{id,transactionHash}` to `/api/wallet/connected/confirm`. Retrying a connected send/fee key returns the original operation of that kind; do not reuse it for changed payment details. Native sends use `asset:"native"` and require POL for both value and gas.

Legacy approval example for an admin reviewing an existing deposit:

```json
{"decision":"approved","reference":"<unique verified receipt reference>","verified":true,"note":"Receipt checked by operator"}
```

This records an operator's verification and credits the ledger atomically; it does not independently query a bank or prove a token deposit.

## 8. Rate limits and errors

Limits are per scope and IP, including account ID where the scope uses it, in fifteen-minute windows. An exceeded limit returns 429 and `Retry-After: 900`.

| Scope/action | Attempts / 15 minutes |
| --- | ---: |
| Legacy registration / member login / admin login | 10 / 30 / 15 |
| Wallet challenge / verify | 50 / 40 |
| Profile rename / sponsor attach | 30 / 15 |
| Chain prepare / confirm / embedded purchase | 40 / 100 / 30 |
| Legacy activation / upgrade | 12 / 30 |
| Balance / indexed history | 60 / 30 |
| Embedded wallet create / key reveal | 5 / 5 |
| External send prepare / operation confirm | 40 / 100 |
| Embedded send quote / submit | 40 / 20 |
| Legacy funding request / transfer | 30 / 15 |
| Admin user change / payment review / settings write | 60 / 60 / 30 |
| External fee prepare / embedded fee submit | 30 / 20 |

Not every read endpoint has a per-route rate-limit call. A successful HTTP response means the handler succeeded, not necessarily that a blockchain transaction is confirmed; inspect the returned status.

| HTTP status | Typical meaning |
| --- | --- |
| 200 / 201 / 202 | Success / legacy account created / embedded transaction still pending |
| 400 | Invalid body/query/address/amount or unsuitable transaction details |
| 401 | Missing/expired session, invalid credentials/signature/password |
| 403 | Wrong role/origin/mode, suspended account or disabled operation |
| 404 | Missing owned record/wallet/member or unavailable private branch |
| 409 | State conflict, existing pending action, next-level mismatch, stale quote, reused intent/reference |
| 413 | Declared request body too large |
| 429 | Rate limit exceeded |
| 503 | Required blockchain/explorer configuration or provider unavailable |
| 500 | Unexpected/internal failure, including unavailable stored wallet state |

Nuxt/H3 error serialization can include a `statusMessage`; UI localization maps stable messages. Providers' private details and signing secrets must not be treated as response fields. Reconcile indeterminate submissions using their existing IDs/hashes rather than creating another payment.

## 9. Source contracts

[All route handlers](../../server/api), [auth and Origin checks](../../server/utils/auth.ts), [API headers](../../server/middleware/api-headers.ts), [mode checks](../../server/utils/wallet-mode.ts), [shared types](../../shared), [external transaction flow](../../server/utils/external-wallet.ts), [payment rules](payments-and-conditions.md).
