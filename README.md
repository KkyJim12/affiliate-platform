# UNXO — matrix and referral workspace

Nuxt 4 app with a three-layer binary matrix UI, 15-rank explorer, 15-level unilevel projections, username/password accounts, and persistent in-app USDT ledger wallets. The UNXO interface uses a modern gold palette with light and dark themes.

Branding uses the supplied UNXO artwork from `public/logo.jpg`. The horizontal, transparent version is in `public/unxo-horizontal.webp`, with its full-resolution PNG master alongside it. `BrandLogo.vue` shares responsive sizing across navigation, account dialogs, footers, and compact decorative emblems. The original image also supplies the browser icon. See `design/unxo-logo-prompt.md` for generation details.

Appearance uses the installed `@nuxtjs/color-mode` module. A single sun/moon icon in each header toggles between light and dark, with the same two choices available in account settings. Light is the default; choices persist in `loop-color-mode` local storage. Older saved system preferences migrate to their current light or dark appearance. Theme classes are applied before rendering to avoid a light flash. Shared tokens in `app/assets/css/theme.css` cover public pages, dashboard views, dialogs, and diagrams. Downloaded referral SVGs resolve the active theme's colors so they display independently of the app.

English and Thai use `@nuxtjs/i18n` (Vue I18n). Switch languages in either header or account settings; the `loop_locale` cookie preserves the selection across reloads and pages without changing URLs. The initial visit follows the browser language, falling back to English. Translation catalogs live in `i18n/locales/en.json` and `th.json`, including dialogs, validation/API errors, notifications, accessible labels, and diagram downloads. `useLoopI18n` translates stable server descriptions and formats dates for the active locale (Thai uses the Buddhist calendar). The locally bundled Noto Sans Thai font supports both themes.

All selection controls use the shared `AppDropdown` component, with themed listbox menus, selected-item indicators, keyboard navigation and typeahead, Escape cancellation, and outside-click dismissal. Menus render above card boundaries and adjust their position to fit the viewport on desktop and mobile.

Motion is shared through `app/assets/css/motion.css` and `usePageMotion`: route fades, staggered scroll reveals across all dashboard views, floating brand artwork, card/button feedback, FAQ expansion, modal slide-down entrances and slide-up exits, dropdown entrances, transaction rows, and matrix branches. Server-rendered content stays readable before JavaScript loads. Reduced-motion preferences disable both CSS and browser-driven animation, including live preference changes; keyboard focus reveals controls immediately. View transitions preserve the existing form and filter state. `ModalTransition` wraps every conditional dialog, retains the backdrop and body scroll lock through the exit, makes departing content inactive, and restores focus after closing.

## Run locally

Requires Node.js 24 or later for built-in SQLite. Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`.

```sh
npm install
npm run dev
```

Open http://localhost:3000. Create an account through the sign-in dialog. No Privy keys, browser wallet, email provider, or blockchain connection is required. An optional `.env` can use the values in `.env.example`.

## Administrator workspace

Run `npm run admin:create` (`npm.cmd run admin:create` in PowerShell) and choose a new administrator username and a password of at least 12 characters. Password input is hidden. Then open `/admin/login`. Non-interactive setup accepts `LOOP_ADMIN_USERNAME` and `LOOP_ADMIN_PASSWORD`; it uses the same `LOOP_DATABASE_PATH` as the server. There are no default credentials or public admin registration. Existing accounts are never overwritten.

The protected `/admin/dashboard`, `/admin/users`, `/admin/payments`, and `/admin/settings` pages use live SQLite data, with English/Thai, light/dark mode, responsive navigation, custom dropdowns, and reduced-motion support. The dashboard shows account growth, funding totals, wallet balances, recent payments, and an admin activity log. Users can be searched, filtered, paginated, inspected, suspended, and reactivated. Suspension revokes sessions and blocks sign-in and transfers to the suspended recipient; administrator accounts are protected from suspension.

Payments lists wallet funding requests. After independently verifying receipt, an administrator can approve a request using a unique settlement reference; the wallet credit, completion record, review, and audit entry commit atomically. Repeated identical approvals never credit twice. Rejection requires a reason, adds no funds, and appears as rejected in the member wallet. This records operator-confirmed settlement; it does not verify blockchain transactions automatically or implement withdrawals.

Settings persist registration/funding availability and a support email shown in the member workspace. The API enforces these switches. Admin routes and every management API require an active admin session; writes require a matching Origin and are rate limited. Access roles, reviews, settings, and the audit trail use additive tables, preserving existing accounts and ledger records.

## Accounts and wallet

Member overview totals come from `/api/dashboard`, including completed ledger commissions and real referral counts. The Refresh action reloads the overview, wallet, and referral network. Login/logout clears account-scoped cached values, while funding requests, transfers, and referral updates refresh the relevant totals. See [API endpoints and request formats](docs/api.md) for integration details.

- Usernames are case-insensitive, 3–24 characters, beginning with a letter. Passwords are 12–128 characters, salted and hashed with scrypt on the server.
- Sessions use random tokens in HttpOnly, SameSite=Strict cookies with a seven-day expiry. Only token hashes are stored. HTTPS requests receive Secure cookies. Mutating requests require a matching Origin; authentication and wallet writes are rate limited.
- Each registration atomically creates a user and zero-balance wallet. Personal referral codes are generated only after a one-time 10 USDT activation from the available wallet balance. Only activated codes from active accounts can establish a sponsor, at registration or later on the referral page. Account, referral, and wallet APIs resolve ownership from the session.
- SQLite persists accounts, hashed credentials, sessions, wallet balances, and transaction records in `.data/loop.sqlite`. This directory is ignored by Git. Set `LOOP_DATABASE_PATH` to use another persistent path. Use the Node server build with durable local storage; static generation and ephemeral filesystem deployments do not support these accounts.
- Money is stored as integer millionths of USDT. Internal transfers verify the sender's password and atomically debit/credit the two wallets with matching ledger entries. Request keys prevent duplicate transfers; insufficient balances and self-transfers are rejected.
- Funding requests create pending records and never increase the available balance. Only an authenticated administrator can credit a request after confirming receipt and recording a unique settlement reference. Automatic blockchain verification, withdrawals, custody, and reconciliation still require integration. Do not send funds to an internal wallet ID; it is not a blockchain address.
- Password recovery, password changes, and multi-factor authentication are not implemented.

## Compensation plan

`shared/plan.ts` is the source for UI calculations. Rank prices follow `10 × 2^(rank − 1)` USDT. Binary rates are 10%, 20%, and 50% across 2, 4, and 8 qualifying positions. Full matrix gross is five times the rank price. The poster's first-cycle illustration retains twice the price and allocates the remaining three times; exact recycling and upgrade rules remain unconfirmed.

Unilevel projections use 1% per ancestor across 15 depths, totaling a 15% pool. Together with the 80% matrix allocation and 5% system allocation, this accounts for 100% of a qualifying payment. These corrected formulas replace inconsistent poster cells.

The unsigned dashboard is explicitly a plan preview with sample matrix positions and wallet activity. Signed-in accounts show their own zero/settled wallet balances and actual registrations. Matrix positions, paid ranks, automatic commissions, recycling, and upgrades are not activated by registration or by funding requests. The rank explorer remains a labeled projection, separate from account funds.

The referrals page at `/referrals` (also `/referral` or `/dashboard?view=referrals`) includes a one-time 10 USDT activation, a code/link sharing panel, and a form for connecting an existing account to a sponsor. Activation verifies the account password and atomically debits the wallet, records a `referral_purchase`, and creates the code. Retries return the same activation without another charge. Accounts with no sponsor can enter an activated code for free; an established sponsor cannot be changed, and self-referrals, suspended sponsors, and cycles at any depth are rejected. Existing sponsor relationships are preserved; older unpaid codes require activation before they can accept new referrals. Referral activation does not trigger rank placement or automatic commission payouts.

The referral network switches between list and tree views. The tree follows actual sponsor relationships across up to 15 levels (first 500 members), with zoom, level controls, and a self-contained SVG image download. Search and status filters preserve ancestor branches for context; matching descendants beyond the selected level limit are revealed automatically. The `layout=tree` query parameter preserves the selected view on refresh. Referral genealogy and binary matrix placement remain separate.

## Explorer

Open `/explorer` (also available as `/dashboard?view=explorer`) in the member workspace or `/admin/explorer` in the admin workspace. Both have Network and Transactions tabs, English/Thai translations, gold light/dark themes, keyboard controls, and responsive layouts. Tab choice, network roots, and transaction filters remain in the URL.

The network explorer supports member inspection from clickable tree nodes, branch navigation, username search with ancestor context, zoom/depth controls, and self-contained SVG downloads. Members can only open branches within their own first 15 referral levels; moving to a descendant does not extend that boundary. Admins can open any account by exact username and inspect up to 15 levels from that root. Responses cap branches at 500 nodes and flag truncation. Unsigned visitors see a labeled sample network.

Transaction search covers ledger IDs, descriptions, owner usernames, and settlement references, with type/status/date filters, pagination, filtered credit/debit/pending totals, and a record detail dialog. Members receive only their own wallet records, including rejection notes and their settlement references. Admins can search all wallets. This is a read-only explorer of the existing in-app ledger; payment review remains in the admin Payments page.

## Database migrations

Versioned SQL files live in `database/migrations/`: accounts/wallets, administration, referral activation, and API query indexes. The server loads these as private Nitro server assets and applies pending migrations before serving requests. Production deployments only need `.output` plus persistent database storage; migration SQL is included in the server build.

```sh
npm run db:status
npm run db:migrate
```

Both commands use `LOOP_DATABASE_PATH` from the environment or `.env`, matching the application and administrator setup. Status is read-only and does not create a missing database. Migrate records filenames, SHA-256 checksums, and timestamps in `schema_migrations`. Pending migrations and their history entries commit as one transaction; failures roll back the entire pending batch. Concurrent runners serialize through SQLite's write lock.

Existing installations without migration history are adopted by the idempotent baseline files. Accounts, password hashes, sessions, sponsor relationships, balances, ledger entries, admin access, reviews, settings, and referral activations are preserved. Existing settings are never replaced by defaults. Migration checksums normalize Windows line endings; changing an applied migration or removing history files stops startup with an explicit error. Append a new numbered SQL file for future changes. Migration files contain schema/data SQL without their own transaction statements. Migrations are forward-only; there is no destructive reset or automatic rollback command.

`npm run test:db` covers fresh schema creation, legacy adoption, constraints, idempotency, failed-batch rollback, checksum/history validation, and simultaneous migration processes using isolated databases.

## Validation

```sh
npm run typecheck
npm run test:db
npm run build
npm run test:ui
```

Build first, then run Playwright. It starts the production server on port 3100 with a separate `.data/playwright.sqlite` database. It uses installed Microsoft Edge for desktop and mobile emulation. Coverage includes account registration/login/logout, persistent sessions, referral ownership, funding-request idempotency, internal transfer conservation/concurrency, unauthorized requests, responsive matrix/rank/wallet interactions, and persisted English/Thai switching alongside theme preferences. Admin checks exercise local account setup, access control, concurrent approval idempotency, unique settlement references, rejection, suspension/session revocation, operational settings, and all management pages on desktop/mobile. Member-only wallet fixtures insert settled credits directly into the isolated test database; admin settlement tests use protected review APIs. Test setup resets operational controls and throttles only in that isolated database.
