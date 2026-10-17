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
| GET | `/api/wallet` | Own wallet balance and recent transactions |
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
