# UNXO — matrix and referral workspace

Nuxt 4 app with a three-layer binary matrix UI, 15-rank explorer, 15-level unilevel projections, username/password accounts, and encrypted EVM wallets. The UNXO interface uses a modern gold palette with light and dark themes.

Branding uses the supplied UNXO artwork from `public/logo.jpg`. The horizontal, transparent version is in `public/unxo-horizontal.webp`, with its full-resolution PNG master alongside it. `BrandLogo.vue` shares responsive sizing across navigation, account dialogs, footers, and compact decorative emblems. The original image also supplies the browser icon. See `design/unxo-logo-prompt.md` for generation details.

Appearance uses the installed `@nuxtjs/color-mode` module. A single sun/moon icon in each header toggles between light and dark, with the same two choices available in account settings. Light is the default; choices persist in `loop-color-mode` local storage. Older saved system preferences migrate to their current light or dark appearance. Theme classes are applied before rendering to avoid a light flash. Shared tokens in `app/assets/css/theme.css` cover public pages, dashboard views, dialogs, and diagrams. Downloaded referral SVGs resolve the active theme's colors so they display independently of the app.

English and Thai use `@nuxtjs/i18n` (Vue I18n). Switch languages in either header or account settings; the `loop_locale` cookie preserves the selection across reloads and pages without changing URLs. The initial visit follows the browser language, falling back to English. Translation catalogs live in `i18n/locales/en.json` and `th.json`, including dialogs, validation/API errors, notifications, accessible labels, and diagram downloads. `useLoopI18n` translates stable server descriptions and formats dates for the active locale (Thai uses the Buddhist calendar). The locally bundled Noto Sans Thai font supports both themes.

All selection controls use the shared `AppDropdown` component, with themed listbox menus, selected-item indicators, keyboard navigation and typeahead, Escape cancellation, and outside-click dismissal. Menus render above card boundaries and adjust their position to fit the viewport on desktop and mobile.

Signed-in navbar profiles open a shared menu on public, member and admin pages.
The profile button includes the on-chain USDT balance; the member navbar no longer
has a separate EVM wallet button. The profile and wallet card share a balance
snapshot for 30 seconds, and a manual wallet refresh updates both. Missing USDT
configuration, another token, or failed reads display an unavailable USDT amount.
It shows the account's EVM address with a copy action, wallet/settings
links and sign out. Menus support keyboard navigation, Escape and outside-click
dismissal, and remain visible within narrow mobile viewports.

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

Open http://localhost:3000. Create an account through the sign-in dialog. No Privy keys, browser wallet, email provider, or blockchain connection is required.

## Administrator workspace

Run `npm run admin:create` (`npm.cmd run admin:create` in PowerShell) and choose a new administrator username and a password of at least 12 characters. Password input is hidden. Then open `/admin/login`. Non-interactive setup accepts `LOOP_ADMIN_USERNAME` and `LOOP_ADMIN_PASSWORD`; it uses the same PostgreSQL `DATABASE_URL` as the server and applies pending migrations. There are no default credentials or public admin registration. Existing accounts are never overwritten.

The protected `/admin/dashboard`, `/admin/users`, `/admin/payments`, and `/admin/settings` pages use live PostgreSQL data, with English/Thai, light/dark mode, responsive navigation, custom dropdowns, and reduced-motion support. The dashboard shows account growth, funding totals, wallet balances, recent payments, and an admin activity log. Users can be searched, filtered, paginated, inspected, suspended, and reactivated. Suspension revokes sessions and blocks sign-in and transfers to the suspended recipient; administrator accounts are protected from suspension.

Payments lists historical wallet funding requests. After independently verifying receipt, an administrator can approve a request using a unique settlement reference; the ledger credit, completion record, review, and audit entry commit atomically. Repeated identical approvals never credit twice. Rejection requires a reason, adds no funds, and remains visible in the transaction explorer. This records operator-confirmed settlement; it does not verify blockchain transactions automatically or implement withdrawals.

Settings persist registration/funding availability and a support email shown in the member workspace. The API enforces these switches. Admin routes and every management API require an active admin session; writes require a matching Origin and are rate limited. Access roles, reviews, settings, and the audit trail use additive tables, preserving existing accounts and ledger records.

## Accounts and wallet

Member overview totals come from `/api/dashboard`, including completed ledger commissions and real referral counts. The Refresh action reloads the overview, wallet, and referral network. Login/logout clears account-scoped cached values, while funding requests, transfers, and referral updates refresh the relevant totals. See [API endpoints and request formats](docs/api.md) for integration details.

- Usernames are case-insensitive, 3–24 characters, beginning with a letter. Passwords are 12–128 characters, salted and hashed with scrypt on the server.
- Sessions use random tokens in HttpOnly, SameSite=Strict cookies with a seven-day expiry. Only token hashes are stored. HTTPS requests receive Secure cookies. Mutating requests require a matching Origin; authentication and wallet writes are rate limited.
- Each registration atomically creates a user, zero-balance ledger wallet and password-encrypted Polygon Amoy wallet. Personal referral codes are generated after a confirmed level 1 contract purchase using the configured Amoy token. Only activated codes from active accounts can establish a sponsor, at registration or later on the referral page. Account, referral, and wallet APIs resolve ownership from the session.
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

The member wallet is one EVM balance card on both the overview and wallet page.
It shows the existing address, network, live balances, Send, Receive and wallet details.
The old internal balance, LW ID, funding requests, member transfers and ledger
history have been removed from this card. Settings and navigation also use the
EVM wallet. Existing addresses, encrypted keys and historical ledger records are
preserved. Referrals now pay through the smart contract using the configured
Amoy token. Historical credits remain available only in explicit legacy ledger
mode. Send transfers native POL or the configured Amoy token to an address after
reviewing the amount and maximum gas fee and confirming the account password.
Signed sends persist before broadcast, recover automatically, and share a nonce
lock with referral purchases. See [wallet sends](docs/api.md#evm-wallet-sends).

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

Ethers generates an account wallet on Polygon Amoy testnet (chain ID 80002).
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

Every contract activation and upgrade collects and distributes 100% in one on-chain transaction; verified receipts are then mirrored into PostgreSQL. Sponsor ancestors 1–3 receive 50%, 20%, 10% of the whole purchase (80% total). An additional 15% is shared across ancestors 1–15 with normalized halving weights, `2^(15 − depth) / 32767`; the first three receive both kinds of commission. Largest-remainder rounding conserves the exact 15% pool in integer micro-USDT. The platform gets 5%. Missing, suspended, unactivated, or wallet-less upline shares are sent to the platform address by the contract. No ancestor is moved into another position. Binary illustrations in `shared/plan.ts` use the same direct rates; actual payouts follow the sponsor genealogy.

Set the owner and initial fee recipient in `.env` before deployment. Admin Settings reads the current on-chain recipient and lets its owner submit a signed update. Purchases require configured token/contract addresses and token plus POL balances. New distributions are actual ERC-20 transfers; historical internal-ledger payables remain separate. The default contract mode never silently spends or credits internal balances.

The referrals page at `/referrals` (also `/referral` or `/dashboard?view=referrals`) includes activation, current level, sequential upgrades, code/link sharing, a distribution summary, and sponsor linking. Purchases verify the password, debit the wallet, record the purchase and all allocations, and credit eligible uplines atomically. Consistent wallet lock ordering prevents transfer deadlocks. Request keys and unique user/level records prevent duplicate charges and commissions. Accounts with no sponsor can enter an activated code for free; an established sponsor cannot be changed, and self-referrals, suspended sponsors, and cycles at any depth are rejected. Existing sponsor relationships are preserved; older unpaid codes require activation before they can accept new referrals. Registration and funding alone do not purchase a level or place binary matrix positions. The rank explorer remains a projection, separate from paid account levels.

The referral network switches between list and tree views. The tree follows actual sponsor relationships across up to 15 levels (first 500 members), with zoom, level controls, and a self-contained SVG image download. Search and status filters preserve ancestor branches for context; matching descendants beyond the selected level limit are revealed automatically. The `layout=tree` query parameter preserves the selected view on refresh. Referral genealogy and binary matrix placement remain separate.

## Explorer

Open `/explorer` (also available as `/dashboard?view=explorer`) in the member workspace or `/admin/explorer` in the admin workspace. Both have Network and Transactions tabs, English/Thai translations, gold light/dark themes, keyboard controls, and responsive layouts. Tab choice, network roots, and transaction filters remain in the URL.

The network explorer supports member inspection from clickable tree nodes, branch navigation, username search with ancestor context, zoom/depth controls, and self-contained SVG downloads. Members can only open branches within their own first 15 referral levels; moving to a descendant does not extend that boundary. Admins can open any account by exact username and inspect up to 15 levels from that root. Responses cap branches at 500 nodes and flag truncation. Unsigned visitors see a labeled sample network.

Transaction search covers ledger IDs, descriptions, owner usernames, and settlement references, with type/status/date filters, pagination, filtered credit/debit/pending totals, and a record detail dialog. Members receive only their own wallet records, including rejection notes and their settlement references. Admins can search all wallets. This is a read-only explorer of the existing in-app ledger; payment review remains in the admin Payments page.

## Database migrations

Versioned PostgreSQL SQL files live in `database/migrations/`: accounts/wallets, administration, referral activation, and API query indexes. The server loads these as private Nitro server assets and applies pending migrations before serving requests. Production deployments need `.output` and `DATABASE_URL` pointing to an existing PostgreSQL database; migration SQL is included in the server build.

```sh
npm run db:status
npm run db:migrate
```

Both commands use `DATABASE_URL` from the environment or `.env`, matching the application and administrator setup. Status only reads migration history; neither command creates the PostgreSQL database itself. Migrate records filenames, SHA-256 checksums, and timestamps in `schema_migrations`. Pending migrations and their history entries commit as one transaction on a single pooled connection; failures roll back the entire pending batch. Concurrent runners serialize through a PostgreSQL advisory transaction lock.

PostgreSQL has its own migration history. Existing SQLite files and their migration history are not used by the running application. Migration checksums normalize Windows line endings; changing an applied PostgreSQL migration or removing history files stops startup with an explicit error. Append a new numbered SQL file for future changes. Migration files contain schema/data SQL without their own transaction statements. Migrations are forward-only; there is no destructive reset or automatic rollback command.

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
