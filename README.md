# UNXO — matrix and referral workspace

Members are identified by numeric **Member ID** throughout the UI and public API. Credential login uses `{memberId,password}`; embedded registration assigns an ID automatically and accepts `{password,sponsorCode?}`. IDs cannot be edited. Find existing admin IDs with `npm run admin:list`. See [the identity migration notes](docs/member-id-update.md).

เอกสารระบบฉบับภาษาไทยและภาษาอังกฤษ: [สารบัญ / Documentation index](docs/README.md). Covers the full system, all 52 API routes, installation/operations, fifteen-level prices, payment flows, commission eligibility and implemented conditions. Start with [ภาษาไทย](docs/th/system-guide.md) or [English](docs/en/system-guide.md); see [การจ่ายเงินและเงื่อนไข](docs/th/payments-and-conditions.md) / [Payments and conditions](docs/en/payments-and-conditions.md).

PDF สรุป / Summary PDFs: [ภาษาไทย · 4 หน้า](docs/pdf/UNXO-summary-th.pdf) · [English · 4 pages](docs/pdf/UNXO-summary-en.pdf) · [รวมสองภาษา / Bilingual · 8 pages](docs/pdf/UNXO-summary-bilingual.pdf). Regenerate with `npm run docs:summary:pdf`.

Connected wallets are now the default for members: wallet signatures for login and every on-chain write, with 1% bonuses at each of 15 depths. See [connected wallet setup, existing-account linking and distributor replacement](docs/connected-wallets.md). In-app key management and password-authorized transactions below apply only when `NUXT_PUBLIC_WALLET_MODE=embedded` is explicitly enabled.

Administrators sign in at `/admin/login` with their member ID and password, including after linking a transaction wallet. Member member ID/password login is hidden and disabled by default. Set `NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED=true` and restart to enable legacy member login or link an existing account; embedded member login also requires this flag.

Nuxt 4 app with a referral tree overview, 15-rank explorer, 15-level unilevel projections, wallet-signature accounts, and connected EVM wallets. The UNXO interface uses a modern gold palette with light and dark themes.

Branding uses the supplied UNXO artwork from `public/logo.jpg`. The horizontal, transparent version is in `public/unxo-horizontal.webp`, with its full-resolution PNG master alongside it. `BrandLogo.vue` shares responsive sizing across navigation, account dialogs, footers, and compact decorative emblems. The original image also supplies the browser icon. See `design/unxo-logo-prompt.md` for generation details.

Appearance uses the installed `@nuxtjs/color-mode` module. A single sun/moon icon in each header toggles between light and dark, with the same two choices available in account settings. Dark is the default; choices persist in `loop-color-mode` local storage. Older saved system preferences migrate to their current light or dark appearance. Theme classes are applied before rendering. Shared tokens in `app/assets/css/theme.css` cover public pages, dashboard views, dialogs, and diagrams. Downloaded referral SVGs resolve the active theme's colors so they display independently of the app.

English and Thai use `@nuxtjs/i18n` (Vue I18n). Switch languages in either header or account settings; the `loop_locale` cookie preserves the selection across reloads and pages without changing URLs. New visitors start in Thai regardless of browser language; saved preferences load during server rendering and hydration. Translation catalogs live in `i18n/locales/en.json` and `th.json`, including dialogs, validation/API errors, notifications, accessible labels, and diagram downloads. `useLoopI18n` translates stable server descriptions and formats dates for the active locale (Thai uses the Buddhist calendar). The locally bundled Noto Sans Thai font supports both themes.

All selection controls use the shared `AppDropdown` component, with themed listbox menus, selected-item indicators, keyboard navigation and typeahead, Escape cancellation, and outside-click dismissal. Menus render above card boundaries and adjust their position to fit the viewport on desktop and mobile.

Signed-in navbar profiles open a shared menu on public, member and admin pages.
The profile button includes the on-chain USDT balance; the member navbar no longer
has a separate EVM wallet button. The profile and wallet card share a balance
snapshot for 30 seconds, and a manual wallet refresh updates both. USDT and the configured Amoy tUSDT are supported, with the actual token symbol shown. Missing token
configuration, another token, or failed reads display an unavailable amount.
It shows the account's EVM address with a copy action, wallet/settings
links and sign out. Menus support keyboard navigation, Escape and outside-click
dismissal, and remain visible within narrow mobile viewports. The profile menu, Referrals and EVM Wallet share the same linked address, network and balance summary. A selected extension is remembered locally; reloads reattach only an already-authorized matching account on Amoy through read-only provider calls. Signing still requires wallet approval.

Motion is shared through `app/assets/css/motion.css` and `usePageMotion`: route fades, staggered scroll reveals across all dashboard views, floating brand artwork, card/button feedback, FAQ expansion, modal slide-down entrances and slide-up exits, dropdown entrances, transaction rows, and matrix branches. Server-rendered content stays readable before JavaScript loads. Reduced-motion preferences disable both CSS and browser-driven animation, including live preference changes; keyboard focus reveals controls immediately. View transitions preserve the existing form and filter state. `ModalTransition` wraps every conditional dialog, retains the backdrop and body scroll lock through the exit, makes departing content inactive, and restores focus after closing.

## Run locally

Requires Node.js 24 or later and PostgreSQL 17 or later. Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`.

```sh
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

Before running these commands, set `DATABASE_URL` in `.env` using `.env.example`. The supplied local URL matches `compose.yaml`; Docker stores PostgreSQL data in a persistent volume and binds its port to localhost. An existing PostgreSQL installation or hosted database also works: create a database and supply its connection URL. Use your provider's SSL parameters for hosted connections. Local Compose credentials are for development only.

Without Docker or an installed PostgreSQL service, run `npm run db:start` in a separate terminal before migrations and development. It starts a native PostgreSQL 17 process on the localhost port in `DATABASE_URL`, creates that database if missing, and keeps data in `.data/postgresql`. Keep the terminal open; Ctrl+C stops the service and retains its data. This development command requires the `embedded-postgres` dev dependency. Choose either this command or Docker for a given port.

Open http://localhost:3000. Create an account through the sign-in dialog. Choose MetaMask, Rabby or Phantom and sign the login message. Purchases use Polygon Amoy test tokens.

## Administrator workspace

Run `npm run admin:create` (`npm.cmd run admin:create` in PowerShell) and choose a password of 12–128 characters. Password input is hidden; setup prints the assigned administrator member ID. Open `/admin/login` with that ID and password. Use `npm run admin:list` to find existing admin IDs. Non-interactive setup accepts `LOOP_ADMIN_PASSWORD`; it uses the same PostgreSQL `DATABASE_URL` and applies pending migrations. There are no default credentials or public admin registration. Existing accounts are never overwritten.

The protected `/admin/dashboard`, `/admin/users`, `/admin/explorer`, and `/admin/settings` pages use live PostgreSQL data, with English/Thai, light/dark mode, responsive navigation, custom dropdowns, and reduced-motion support. The dashboard shows account totals, account growth and an admin activity log. Payments navigation, funding widgets and the payment-review page have been removed; old payment-page URLs redirect to the dashboard. Users can be searched, filtered, paginated, inspected, suspended, and reactivated. Suspension revokes sessions and blocks sign-in and transfers to the suspended recipient; administrator accounts are protected from suspension.

Member IDs are read-only in account settings and admin account details. Administrators can search by member ID and suspend/reactivate members. Existing account UUIDs, numeric IDs, wallet links, sponsor relationships and history are preserved; legacy private handles are retained only for storage/import compatibility.

Historical funding records and authenticated settlement APIs remain for legacy compatibility. These APIs require receipt verification and unique settlement references; ledger credits, reviews and audit entries commit atomically. They are separate from contract purchases and the current admin interface.

Settings persist registration/funding availability and a support email shown in the member workspace. The API enforces these switches. Admin routes and every management API require an active admin session; writes require a matching Origin and are rate limited. Access roles, reviews, settings, and the audit trail use additive tables, preserving existing accounts and ledger records.

## Accounts and wallet

Member overview totals come from `/api/dashboard`, including completed ledger commissions and real referral counts. The Refresh action reloads the overview, wallet, and referral network. Login/logout clears account-scoped cached values, while funding requests, transfers, and referral updates refresh the relevant totals. See [API endpoints and request formats](docs/api.md) for integration details.

Overview uses the same referral tree as My referrals. FAQ contains Ranks & commissions (`/faq/ranks`) and Analytics (`/faq/analytics`, also `/analytics`). Analytics reads platform account counts, confirmed contract purchases, verified distributions and 30 days of activity from PostgreSQL. The former My matrix view redirects to Overview.

Explorer opens public contract transactions from `/api/platform/transactions`: purchases and fee-recipient updates recorded for `NUXT_REFERRAL_CONTRACT_ADDRESS`, with pending/confirmed/failed states, search, filters and pagination. It excludes unsigned quotes and private ledger entries. This is recorded platform activity; transactions submitted directly outside the platform need a separate chain indexer to appear. Recent sends appears on Overview; the EVM wallet page retains its indexed transaction list.

Landing page Launch App links open the dashboard. Invite-code fields remain visible in the sign-in dialog and prefill from a valid `?ref=` on any page. The latest incoming code is remembered in the current browser tab.

- Member IDs are numeric and assigned automatically. Passwords are 12–128 characters, salted and hashed with scrypt on the server.
- Sessions use random tokens in HttpOnly, SameSite=Strict cookies with a seven-day expiry. Only token hashes are stored. HTTPS requests receive Secure cookies. Mutating requests require a matching Origin; authentication and wallet writes are rate limited.
- Connected-wallet registration atomically creates a user, zero-balance legacy ledger wallet and external wallet link, without generating an embedded private key or usable member password. Explicit embedded registration instead creates a password-encrypted Polygon Amoy wallet. Numeric member IDs are assigned at registration and become eligible referral codes after a confirmed level 1 purchase in the selected payment mode. Only activated codes from active accounts can establish a sponsor, at registration or later on the referral page. Account, referral, and wallet APIs resolve ownership from the session.
- PostgreSQL persists accounts, hashed credentials, sessions, wallet balances, and transaction records. Set `DATABASE_URL`; there is no SQLite fallback. Use the Node server build with a reachable PostgreSQL database; static generation cannot serve the account APIs.
- Money is stored as BIGINT integer millionths of USDT with nonnegative, safe-integer balance constraints. Historical internal transfers verify the sender's password and atomically debit/credit the two wallets with matching ledger entries. Wallet row locks use consistent ordering to protect concurrent transfers. Request keys prevent duplicate transfers; insufficient balances and self-transfers are rejected. Contract purchases use signed transactions, receipt verification and a durable transaction outbox.
- Historical funding requests create pending records and never increase the available balance. Only an authenticated administrator can credit a request after confirming receipt and recording a unique settlement reference. General funding settlement and withdrawals remain separate from automatic referral contract payments. Do not send funds to an internal wallet ID; it is not a blockchain address.
- Password recovery, password changes, and multi-factor authentication are not implemented.

## Smart contract library

Referral purchases now use `contracts/ReferralDistributor.sol` to collect and
automatically distribute ERC-20 tokens on Polygon Amoy. Contract mode is the
default; missing blockchain configuration disables purchases rather than spending
internal credits. Run `npm run contracts:prepare`, set the owner, initial fee
recipient and funded deployer fields in `.env`, inspect
`npm run contracts:deploy`, then deploy with
`npm run contracts:deploy -- --broadcast`. This deploys a separate, valueless
`AmoyTestUSDT` token and saves both confirmed contract addresses. See
[deployment, authorization and recovery](docs/referral-contract.md).

Verify both deployed contracts with `npm run contracts:verify` using
`ETHERSCAN_API_KEY` in `.env`. Preview the exact source and constructor inputs
with `npm run contracts:verify -- --dry-run`.

The standalone member wallet page is `/wallet`; old `/dashboard?view=wallet` links redirect there. The sidebar places FAQ and its submenus after the divider, immediately before Account settings.

The member wallet is one EVM balance card on both the overview and wallet page.
It shows the existing address, network, live balances, Send and a Wallet details
button. Wallet details opens a modal with the linked address, network, copy and
explorer actions. Keys stay in the connected wallet.
The old internal balance, LW ID, funding requests, member transfers and ledger
history have been removed from this card. Settings and navigation also use the
EVM wallet. Existing addresses, encrypted keys and historical ledger records are
preserved. Referrals now pay through the smart contract using the configured
Amoy token. Historical credits remain available only in explicit legacy ledger
mode. Send transfers native POL or the configured Amoy token after review and a
wallet signature. The backend prepares unsigned intents and verifies receipts.
See [connected wallet transactions](docs/connected-wallets.md#transaction-approval).

`GET /api/wallet/evm/balance` reads the signed-in owner's native POL balance on
Amoy. It uses `NUXT_EVM_RPC_URL` or the public Amoy RPC, and rejects another
configured or actual network. Set `NUXT_EVM_TOKEN_ADDRESS` to show that Amoy
ERC-20 balance as the main amount, alongside POL for gas. The contract's metadata
supplies its symbol and decimals; no USDT address or balance is invented.
An unavailable RPC shows an unavailable balance with a retry action.

The wallet page has a separate `WalletTransactions.vue` panel below its wallet
card. It displays up to 50 recent indexed Amoy records with POL transactions,
ERC-20 transfers, direction/search filters, status, Bangkok dates and explorer
links. Set the private `NUXT_EVM_EXPLORER_API_KEY` to an Etherscan V2 key with
Amoy access to enable live history. `NUXT_EVM_TOKEN_ADDRESS` optionally limits
token transfers to the configured contract; otherwise ERC-20 transfers for all
tokens are included. Missing credentials/provider failures show an unavailable
state, while an actual empty history has its own message. No ledger records or
sample transactions are presented as on-chain activity.

In explicit embedded mode, Ethers generates an account wallet on Polygon Amoy testnet (chain ID 80002).
PostgreSQL stores its address, public key and V3 keystore encrypted with the
account password. The wallet page displays public details; revealing the private
key requires that password and hides it after 30 seconds. Existing accounts get
a wallet on their next sign-in or through password confirmation on the wallet
page. Generation needs no RPC or `.env` encryption key. Back up the database and
retain the password; lost passwords cannot recover encrypted keys. See
[wallet encryption and lifecycle](docs/smart-contracts.md#polygon-amoy-account-wallets).

Viem supplies optional EVM token reads, allowance checks, exact token/ledger amount
conversion, and transfer receipt inspection for Ethereum, BNB Chain, Polygon,
Amoy and Sepolia. Configure the private `NUXT_EVM_*` entries in `.env.example` when using
the server helpers. See [smart contract functions and integration analysis](docs/smart-contracts.md)
for usage, the mapping to funding/referral flows, and proposed future contract
functions. Funding approval remains manual; automatic settlement and withdrawals
need account/payment binding and persistent event reconciliation.

Run `npm run test:contracts` for offline helper tests without a database or wallet.

## Compensation plan

`shared/compensation.ts` is the source for purchase prices and exact allocations. Level 1 activates a personal referral code for 10 USDT. Each sequential upgrade costs twice the previous level: 20, 40, 80 USDT, through level 15 at 163,840 USDT. Each upgrade charges its full price and retains the same code. Existing paid activations remain level 1, without retroactive commissions.

Every contract activation and upgrade collects and distributes 100% in one on-chain transaction; verified receipts are then mirrored into PostgreSQL. Sponsor ancestors 1–3 receive 50%, 20%, 10% of the whole purchase (80% total). An additional 15% pays exactly 1% at each depth 1 to 15; the first three receive both shares. Unused trailing bonus shares pay the highest eligible upline. The platform gets 5%. Missing direct shares and ineligible gaps go to the platform. Without an eligible upline, the full bonus pool also goes to the platform. Binary illustrations in `shared/plan.ts` use the same direct rates; actual payouts follow the sponsor genealogy.

Set the owner and initial fee recipient in `.env` before deployment. Admin Settings reads the current on-chain recipient and lets its owner submit a signed update. Purchases require configured token/contract addresses and sufficient payment tokens. The app does not check POL balances or require a gas quote for purchases; network fees still apply. New distributions are actual ERC-20 transfers; historical internal-ledger payables remain separate. The default contract mode never silently spends or credits internal balances.

The referrals page at `/referrals` (also `/referral` or `/dashboard?view=referrals`) includes activation, current level, sequential upgrades, code/link sharing, a distribution summary, and sponsor linking. Purchases require the connected wallet to sign approval and payment; the contract transfers all allocations atomically, and the backend mirrors confirmed receipts. Consistent wallet lock ordering prevents transfer deadlocks. Request keys and unique user/level records prevent duplicate charges and commissions. Accounts with no sponsor can enter an activated code for free; an established sponsor cannot be changed, and self-referrals, suspended sponsors, and cycles at any depth are rejected. Existing sponsor relationships are preserved; older unpaid codes require activation before they can accept new referrals. Registration and funding alone do not purchase a level or trigger a commission. The rank explorer remains a projection, separate from paid account levels.

Public member IDs are consecutive numbers (`1`, `2`, `3`, …), assigned atomically
at registration and retained through activation and upgrades. The next startup
migrates existing accounts in registration order while preserving their internal
UUIDs, sponsor links, wallets and history. Previously shared `UNXO-` and `LOOP-`
invites still resolve through aliases. An ID becomes an eligible invite after
the existing level 1 activation requirement is met.

Anyone can open `/search` (also `/tree`), enter an ID, and view that member's
actual sponsor tree without signing in. All direct referrals stay beneath their
sponsor, including a third or later child, ordered by registration time and ID.
Empty previews use two branches. Paths use sibling indices separated by `/`,
such as `0/2/1`, across at most 15 descendant levels. Overview and My referrals
use the same endpoint. The UI offers 3, 4, 5 or 15 visible levels with branch
navigation and viewport rendering; the API accepts `levels=1..15`, default 3.
Public responses expose numeric IDs, member IDs, parent/path links and level counts.

The schema retains binary `referral_placements` and registration triggers, but
the current displayed tree reads `users.sponsor_id`. Commission ancestry also
follows original sponsor links. The My referrals list and private Network
explorer retain their 500-member limit and search/status filters.
The `layout=tree` and `layout=list` parameters preserve the selected view.

## Explorer

Open `/explorer` (also available as `/dashboard?view=explorer`) in the member workspace or `/admin/explorer` in the admin workspace. Both have Network and Transactions tabs, English/Thai translations, gold light/dark themes, keyboard controls, and responsive layouts. Tab choice, network roots, and transaction filters remain in the URL.

The network explorer supports member inspection from clickable tree nodes, branch navigation, member ID search with ancestor context, zoom/depth controls, and self-contained SVG downloads. Members can only open branches within their own first 15 referral levels; moving to a descendant does not extend that boundary. Admins can open any account by exact member ID and inspect up to 15 levels from that root. Responses cap branches at 500 nodes and flag truncation. Unsigned visitors see a labeled sample network.

The default Transactions tab searches public platform contract hashes and addresses, with kind/status/date filters, pagination, confirmed volume and transaction details. It reads submitted purchases and fee updates across accounts from PostgreSQL. Historical private ledger search remains available through the authenticated compatibility API.

## Database migrations

Versioned PostgreSQL SQL files live in `database/migrations/`: accounts/wallets, administration, referral activation, and API query indexes. The server loads these as private Nitro server assets and applies pending migrations before serving requests. Production deployments need `.output` and `DATABASE_URL` pointing to an existing PostgreSQL database; migration SQL is included in the server build.

```sh
npm run db:status
npm run db:migrate
```

Both commands use `DATABASE_URL` from the environment or `.env`, matching the application and administrator setup. Status only reads migration history; neither command creates the PostgreSQL database itself. Migrate records filenames, SHA-256 checksums, and timestamps in `schema_migrations`. Pending migrations and their history entries commit as one transaction on a single pooled connection; failures roll back the entire pending batch. Concurrent runners serialize through a PostgreSQL advisory transaction lock.

PostgreSQL has its own migration history. Existing SQLite files and their migration history are not used by the running application. Migration checksums normalize Windows line endings; changing an applied PostgreSQL migration or removing history files stops startup with an explicit error. Append a new numbered SQL file for future changes. Migration files contain schema/data SQL without their own transaction statements. Migrations are forward-only; rolling back an individual migration is not supported.

To reset the configured database, stop the app and back up first. This deletes
all data in the connection's selected schema (normally `public`), including
accounts, transactions and encrypted wallet keys. Blockchain state persists
separately. The command displays the host, database and schema, then requires
typing `RESET <database-name>`:

```powershell
npm.cmd run db:reset
npm.cmd run admin:create
```

Restart the app afterward. Reset recreates the schema and applies every
migration in one transaction; a migration failure rolls back the reset. The
database must already exist and the connecting role must have permission to
drop and recreate its schema. For non-interactive use, supply the exact database
name explicitly, for example `npm.cmd run db:reset -- --confirm unxo`.

To move existing SQLite data, stop the old application so it cannot accept more writes, retain a backup, configure an empty PostgreSQL destination, and run this **before creating accounts or administrators in PostgreSQL**:

```sh
npm run db:import:sqlite -- --source .data/loop.sqlite
```

The importer reads SQLite in a snapshot without modifying it. It copies accounts, original password hashes, sessions, sponsor relationships, balances, ledger records, access roles, payment reviews, audit history, settings, referral activations, and throttles in one PostgreSQL transaction. It preserves ledger insertion order and reconnects sponsor relationships after inserting accounts. PostgreSQL must contain no business records and only default settings; import refuses an occupied destination. Constraint violations roll back all copied data. SQLite migration history is deliberately excluded. Change the source path if the old installation used a custom SQLite file. `LOOP_DATABASE_PATH` is no longer used.

`npm run test:db` covers fresh schema creation, safe money constraints, case-insensitive uniqueness, idempotency, rollback, checksum/history validation, concurrent migration processes, competing debits, and SQLite import preservation using an isolated PostgreSQL server.

## Validation

```sh
npm run typecheck
npm run test:contracts
npm run test:compensation
npm run test:distributor
npm run test:db
npm run build
npm run test:ui
npm run test:onchain
```

Build first, then run Playwright. Both test commands start a disposable PostgreSQL server on a random localhost port, without reading the application's `DATABASE_URL`, and remove their own test files after shutdown. The development dependency `embedded-postgres` supplies real PostgreSQL binaries; its package installation scripts must be enabled. To use an existing test server instead, explicitly set `TEST_DATABASE_URL` to a disposable database whose name ends in `_test`. Test setup resets operational controls and throttles only in that test database.

Playwright starts the production application on port 3100 and uses installed Microsoft Edge for desktop and mobile emulation. Coverage includes account registration/login/logout, persistent sessions, referral ownership, funding-request idempotency, internal transfer conservation/concurrency, unauthorized requests, responsive matrix/rank/wallet interactions, and persisted English/Thai switching alongside theme preferences. Admin checks exercise local account setup, access control, concurrent approval idempotency, unique settlement references, rejection, suspension/session revocation, operational settings, and all management pages on desktop/mobile. Member-only wallet fixtures insert settled credits directly into the isolated PostgreSQL database; admin settlement tests use protected review APIs.
