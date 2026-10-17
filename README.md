# Loop — matrix and referral workspace

Nuxt 4 app with a three-layer binary matrix UI, 15-rank explorer, 15-level unilevel projections, username/password accounts, and persistent in-app USDT ledger wallets. The Loop interface uses a modern gold palette with light and dark themes.

Branding uses the supplied UNXO artwork from `public/logo.jpg`. The horizontal, transparent version is in `public/unxo-horizontal.webp`, with its full-resolution PNG master alongside it. `BrandLogo.vue` shares responsive sizing across navigation, account dialogs, footers, and compact decorative emblems. The original image also supplies the browser icon. See `design/unxo-logo-prompt.md` for generation details.

Appearance uses the installed `@nuxtjs/color-mode` module. A single sun/moon icon in each header toggles between light and dark, with the same two choices available in account settings. Light is the default; choices persist in `loop-color-mode` local storage. Older saved system preferences migrate to their current light or dark appearance. Theme classes are applied before rendering to avoid a light flash. Shared tokens in `app/assets/css/theme.css` cover public pages, dashboard views, dialogs, and diagrams. Downloaded referral SVGs resolve the active theme's colors so they display independently of the app.

English and Thai use `@nuxtjs/i18n` (Vue I18n). Switch languages in either header or account settings; the `loop_locale` cookie preserves the selection across reloads and pages without changing URLs. The initial visit follows the browser language, falling back to English. Translation catalogs live in `i18n/locales/en.json` and `th.json`, including dialogs, validation/API errors, notifications, accessible labels, and diagram downloads. `useLoopI18n` translates stable server descriptions and formats dates for the active locale (Thai uses the Buddhist calendar). The locally bundled Noto Sans Thai font supports both themes.

All selection controls use the shared `AppDropdown` component, with themed listbox menus, selected-item indicators, keyboard navigation and typeahead, Escape cancellation, and outside-click dismissal. Menus render above card boundaries and adjust their position to fit the viewport on desktop and mobile.

Motion is shared through `app/assets/css/motion.css` and `usePageMotion`: route fades, staggered scroll reveals across all dashboard views, floating brand artwork, card/button feedback, FAQ expansion, dialog/dropdown entrances, transaction rows, and matrix branches. Server-rendered content stays readable before JavaScript loads. Reduced-motion preferences disable both CSS and browser-driven animation, including live preference changes; keyboard focus reveals controls immediately. View transitions preserve the existing form and filter state.

## Run locally

Requires Node.js 24 or later for built-in SQLite. Use `npm.cmd` on Windows if PowerShell blocks `npm.ps1`.

```sh
npm install
npm run dev
```

Open http://localhost:3000. Create an account through the sign-in dialog. No Privy keys, browser wallet, email provider, or blockchain connection is required. An optional `.env` can use the values in `.env.example`.

## Accounts and wallet

- Usernames are case-insensitive, 3–24 characters, beginning with a letter. Passwords are 12–128 characters, salted and hashed with scrypt on the server.
- Sessions use random tokens in HttpOnly, SameSite=Strict cookies with a seven-day expiry. Only token hashes are stored. HTTPS requests receive Secure cookies. Mutating requests require a matching Origin; authentication and wallet writes are rate limited.
- Each registration atomically creates a user, unique referral code, and zero-balance wallet. Valid invite codes establish a sponsor at registration. Account, referral, and wallet APIs resolve ownership from the session.
- SQLite persists accounts, hashed credentials, sessions, wallet balances, and transaction records in `.data/loop.sqlite`. This directory is ignored by Git. Set `LOOP_DATABASE_PATH` to use another persistent path. Use the Node server build with durable local storage; static generation and ephemeral filesystem deployments do not support these accounts.
- Money is stored as integer millionths of USDT. Internal transfers verify the sender's password and atomically debit/credit the two wallets with matching ledger entries. Request keys prevent duplicate transfers; insufficient balances and self-transfers are rejected.
- Funding requests create pending records and never increase the available balance. There is no public endpoint to mint or credit funds. Actual USDT deposit verification, settlement, withdrawals, custody, reconciliation, and an operator settlement workflow still require integration. Do not send funds to an internal wallet ID; it is not a blockchain address.
- Password recovery, password changes, and multi-factor authentication are not implemented.

## Compensation plan

`shared/plan.ts` is the source for UI calculations. Rank prices follow `10 × 2^(rank − 1)` USDT. Binary rates are 10%, 20%, and 50% across 2, 4, and 8 qualifying positions. Full matrix gross is five times the rank price. The poster's first-cycle illustration retains twice the price and allocates the remaining three times; exact recycling and upgrade rules remain unconfirmed.

Unilevel projections use 1% per ancestor across 15 depths, totaling a 15% pool. Together with the 80% matrix allocation and 5% system allocation, this accounts for 100% of a qualifying payment. These corrected formulas replace inconsistent poster cells.

The unsigned dashboard is explicitly a plan preview with sample matrix positions and wallet activity. Signed-in accounts show their own zero/settled wallet balances and actual registrations. Matrix positions, paid ranks, automatic commissions, recycling, and upgrades are not activated by registration or by funding requests. The rank explorer remains a labeled projection, separate from account funds.

The referrals page switches between list and tree views. The tree follows actual sponsor relationships across up to 15 levels (first 500 members), with zoom, level controls, and a self-contained SVG image download. Search and status filters preserve ancestor branches for context; matching descendants beyond the selected level limit are revealed automatically. The `layout=tree` query parameter preserves the selected view on refresh. Referral genealogy and binary matrix placement remain separate.

## Validation

```sh
npm run typecheck
npm run build
npm run test:ui
```

Build first, then run Playwright. It starts the production server on port 3100 with a separate `.data/playwright.sqlite` database. It uses installed Microsoft Edge for desktop and mobile emulation. Coverage includes account registration/login/logout, persistent sessions, referral ownership, funding-request idempotency, internal transfer conservation/concurrency, unauthorized requests, responsive matrix/rank/wallet interactions, and persisted English/Thai switching alongside theme preferences. Test-only settled credits are inserted directly into the isolated test database, never through a public API.
