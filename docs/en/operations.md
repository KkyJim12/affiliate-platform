# UNXO operations and development

[Documentation index](../README.md) · [ภาษาไทย](../th/operations.md) · [System](system-guide.md) · [Payments](payments-and-conditions.md) · [API](api-reference.md)

Reviewed **27 October 2026**, revision `3ffa828`. Commands below are operator instructions; writing this documentation did not deploy contracts, reset databases or transfer assets.

## 1. Local installation

Requirements: Node **24+**, npm and PostgreSQL **17+**. The project includes a lockfile. Windows examples use `npm.cmd` to avoid PowerShell's `npm.ps1` execution-policy issue.

1. Create `.env` from [.env.example](../../.env.example) only when no `.env` already exists, then configure it. Keep existing installation values.
2. Set `DATABASE_URL` for an existing database, or use the development service in [compose.yaml](../../compose.yaml).
3. Install dependencies, start PostgreSQL, migrate and start the application:

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
npm.cmd ci
docker compose up -d postgres
npm.cmd run db:migrate
npm.cmd run admin:create
npm.cmd run dev
```

Open `http://localhost:3000`. Compose binds PostgreSQL only to localhost and uses a persistent volume. Its supplied credentials are for local development.

Without Docker or an installed service, run `npm.cmd run db:start` in a separate terminal. It uses the host/port/database in `DATABASE_URL`, starts native embedded PostgreSQL, creates the local database if missing and keeps data in `.data/postgresql`. Leave that terminal open; Ctrl+C stops the service without deleting data. It requires the `embedded-postgres` dev dependency and its installation scripts. Use one database service per port.

The app can start before blockchain deployment, but contract purchases will remain unavailable. A PostgreSQL connection is mandatory; there is no SQLite runtime fallback.

## 2. Administrator setup

`npm run admin:create` uses the same `DATABASE_URL`, applies migrations and prompts for a new username/password with hidden password input. There are no default admin credentials and no public admin registration; it does not overwrite an existing account. The username follows the standard 3–24 character rule and the password is 12–128 characters.

Noninteractive setup accepts `LOOP_ADMIN_USERNAME` and `LOOP_ADMIN_PASSWORD`. Keep credentials in a private environment rather than documentation or shared command output. Visit `/admin/login` afterward. Admin credentials login remains available regardless of the member password-login flag.

## 3. Configuration reference

Nuxt runtime settings are mapped from the corresponding `NUXT_*` environment names. Restart the server after changes; ensure the process manager actually supplies the intended environment. The checked-in example, rather than private `.env`, is the configuration template.

| Variable | Default / purpose |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL URL; database must exist unless the local helper creates it. Use provider-specified SSL settings for hosted DBs |
| `TEST_DATABASE_URL` | Optional disposable test DB, whose database name must end in `_test`; otherwise runners create an isolated local instance |
| `NUXT_PUBLIC_APP_URL` | Exact canonical origin, including port where applicable; production wallet login requires it; also used for invite links |
| `NUXT_PUBLIC_WALLET_MODE` | `external`; only explicit `embedded` restores in-app key handling |
| `NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED` | `false`; enable deliberately for legacy member credentials/linking; embedded login also needs it |
| `NUXT_EVM_RPC_URL` | Optional Amoy RPC override; wallet/referral helpers have the public Amoy fallback |
| `NUXT_EVM_CHAIN_ID` | If configured for wallet/referral/send flows, must be `80002` |
| `NUXT_EVM_TOKEN_ADDRESS` | Configured ERC-20; the deploy script saves its new tUSDT address here. Without one, native POL sends remain possible |
| `NUXT_EVM_TREASURY_ADDRESS` | Recipient used by generic transfer-evidence helpers; not a replacement for the distributor's fee recipient |
| `NUXT_EVM_MIN_CONFIRMATIONS` | Confirmation policy for generic evidence/send helpers; sends default to two |
| `NUXT_EVM_EXPLORER_API_KEY` | Private Etherscan V2 key with Amoy access for indexed wallet history; absent/failing key produces unavailable history |
| `NUXT_REFERRAL_PAYMENT_MODE` | `contract`; `ledger` takes effect only with embedded wallet mode |
| `NUXT_REFERRAL_CONTRACT_ADDRESS` | Distributor address; new purchases require distribution version 2 |
| `NUXT_REFERRAL_AUTHORITY_PRIVATE_KEY` | Private runtime quote signer; its address must match on-chain `quoteSigner` |
| `NUXT_REFERRAL_MIN_CONFIRMATIONS` | `2`; accepted referral confirmation settings are 1–100 |
| `NUXT_REFERRAL_MIN_GAS_BALANCE` | `0.003` POL minimum displayed administrative gas budget; not a purchase POL precheck |
| `REFERRAL_OWNER_ADDRESS` | Public owner used at deployment; external owner retains signing control in their wallet |
| `REFERRAL_FEE_RECIPIENT_ADDRESS` | Initial public platform recipient used at deployment |
| `REFERRAL_DEPLOYER_PRIVATE_KEY` | Private deployment-only key funded with Amoy test POL; not needed by the running app |
| `ETHERSCAN_API_KEY` | Source-verification key; falls back to `NUXT_EVM_EXPLORER_API_KEY` when blank |
| `REFERRAL_QUOTE_SIGNER_ADDRESS` | Optional **original public** signer address for verification fallback when the saved deployment record is absent |
| `LOOP_ADMIN_USERNAME`, `LOOP_ADMIN_PASSWORD` | Optional one-time noninteractive administrator setup credentials |

The generic Viem transfer-evidence helpers require a consistent RPC, chain, token, treasury and confirmation policy together. Their chain support is not a switch for the Amoy-only application wallet. Never use a `NUXT_PUBLIC_*` variable for keys or secrets.

## 4. Deploy and verify test contracts

Use these commands only when deliberately setting up an Amoy test deployment. Review mode is separate from broadcasting.

1. Run `npm run contracts:prepare`. It compiles contracts, fills missing `.env` deployment fields, generates the server-only quote key once if absent and writes `.data/contracts/deployment-plan.json` without printing the key.
2. Set owner/initial recipient addresses and a separate test-POL-funded deployer key. Set an Amoy RPC and chain ID 80002. The owner should be the externally controlled wallet intended to manage the contract.
3. Run `npm run contracts:deploy` to inspect the public plan without sending a transaction.
4. After reviewing addresses and bytecode hashes, run `npm run contracts:deploy -- --broadcast`. It deploys both the test token and distributor and saves confirmed addresses in `.env`.
5. Restart the application. Check the linked admin wallet, contract owner, token, quote signer and distribution version in contract settings.
6. Set the verification API key; preview with `npm run contracts:verify -- --dry-run`, then run `npm run contracts:verify`.

The test token mints 1,000,000 tUSDT to its initial owner. Each wallet can call `faucet()` once for 400,000 tUSDT; the owner can mint more. There is no general member faucet UI described by this workflow. Token faucets do not provide POL gas.

Deployment stores signed bytes/progress before broadcast for safe retry. Keep `.data/contracts` artifacts and original compiler/dependency versions: verification reconstructs the exact source, bytecode and original constructor arguments. The dry run writes verification artifacts locally without a network submission; normal verification submits sources and polls status without sending a blockchain transaction.

Editing deployment owner/fee values after deployment does not change on-chain ownership or configuration. On-chain updates require the owner. Ownership transfer is two-step. Prices and rates cannot be reconfigured in place.

### Replacing the distributor while preserving the token

Settle existing operations, then back up PostgreSQL, private environment and contract artifacts. Inspect:

```text
npm run contracts:deploy -- --replace-distributor
```

After checking `.data/contracts/replacement-plan.json`, the explicit broadcast form is:

```text
npm run contracts:deploy -- --replace-distributor --previous-contract <CURRENT_DISTRIBUTOR_ADDRESS> --broadcast
```

This deploys a new distributor against the existing token and retains original deployment history. Restart and verify the new address. The contract is non-upgradeable: editing Solidity alone does not alter an existing deployment. Older pending purchases can be verified under their original distribution rules, but replacing configuration with unresolved operations complicates recovery. See the [detailed contract notes](../referral-contract.md) and [connected-wallet migration](../connected-wallets.md).

## 5. Database model and integrity

| Tables | Responsibility |
| --- | --- |
| `users`, `user_access` | Identity, numeric code, original sponsor, username, role and suspension |
| `sessions`, `rate_limits`, `wallet_challenges` | Hashed sessions, throttling, one-time wallet login/link challenges |
| `connected_wallets`, `evm_wallets` | External address links versus password-encrypted embedded keystores |
| `wallets`, `wallet_transactions` | Internal available/reserved balances and ledger history |
| `payment_reviews`, `admin_audit`, `platform_settings` | Legacy funding settlement, administrator audit and operational switches |
| `referral_activations`, `referral_purchases`, `referral_allocations` | Activation plus legacy purchases, credits and payables |
| `referral_chain_purchases`, `referral_chain_allocations` | Authorized purchases, receipt status and verified on-chain distributions |
| `referral_chain_fee_updates`, `referral_chain_transactions` | Embedded fee updates and durable signed transaction outbox |
| `evm_sends`, `external_wallet_operations` | Embedded send quotes/submissions and connected send/fee intents |
| `referral_code_aliases`, `referral_id_counter` | Old invitation aliases and sequential numeric member IDs |
| `referral_placements` | Retained binary-placement data; current displayed/payment tree follows `users.sponsor_id` |
| `schema_migrations` | Applied migration names, SHA-256 checksums and timestamps, managed by the migration runner |

Internal money is BIGINT in millionths, checked as nonnegative safe integers. Account names and wallet addresses have case-insensitive uniqueness rules. Request keys, purchased levels, transaction hashes and settlement references have relevant uniqueness constraints. Ledger transfers lock affected wallets consistently; sponsor graph writes use an advisory transaction lock; wallet chain operations use per-account advisory coordination. DB changes and accounting records commit together.

Migrations currently run from `0001` through `0012`; startup applies pending migrations before serving. `npm run db:status` reads history; `npm run db:migrate` applies pending SQL. A pending batch and its history commit in one transaction. Concurrent migrators serialize through an advisory lock. Checksums normalize Windows line endings; editing/removing an applied migration stops validation/startup. Add a new numbered migration instead. Individual migration rollback is not implemented.

### Backups, reset and old SQLite import

Back up PostgreSQL, private environment and deployment/verification records. Embedded wallets additionally depend on the original password and encrypted keystore; losing either prevents key recovery. External wallet recovery belongs to the external wallet, but the database still contains account links, sponsor history and purchase accounting. Restoring a database does not reverse blockchain transfers.

`npm run db:reset` is **destructive**: after showing host/database/schema it requires `RESET <database-name>`, or the explicit CLI form `-- --confirm <database-name>`. It drops/recreates the connection's selected schema and applies migrations transactionally. Stop the app and keep a backup before deliberately using it. It deletes accounts, sessions, ledger records, links and embedded keys; it does not reset blockchain state. Recreate the administrator afterward.

For a supported old SQLite installation, stop writes and preserve the original file, then configure an empty PostgreSQL destination **before creating any accounts/admins**:

```text
npm run db:import:sqlite -- --source .data/loop.sqlite
```

The importer opens SQLite read-only, copies the supported legacy account/ledger/access/review/settings/activation/history tables and reconnects sponsors in one destination transaction. It rejects existing business records or nondefault operational settings. It does not migrate SQLite schema history and is not a general all-table migration tool for newer EVM records/keystores. The live app never uses `LOOP_DATABASE_PATH` or a SQLite fallback.

## 6. Production-style Node hosting

Build and start the Node server with reachable PostgreSQL and the intended environment:

```powershell
npm.cmd run build
node --env-file-if-exists=.env .output/server/index.mjs
```

An environment-injecting process manager can supply variables instead of an `.env` file. Ordinary Node startup does not automatically load that file. Use HTTPS and the exact configured public origin. Preserve the Node process and outbound RPC access so the fifteen-second reconciliation worker can continue. A static `generate` deployment alone cannot serve account/payment APIs or the worker.

All API responses are `no-store`; shared proxies must respect this. Keep database access and private RPC/explorer/authority settings server-side. Application session roles do not replace contract ownership. Operational registration/funding flags do not pause the contract.

## 7. Command catalog

| Command (`npm run ...`) | Purpose |
| --- | --- |
| `dev`, `build`, `preview`, `generate` | Nuxt development, server build, build preview and static generation |
| `postinstall` | Nuxt type/setup preparation; normally runs after install |
| `typecheck` | Nuxt/Vue/TypeScript checks |
| `docs:summary:pdf` | Generate the Thai, English and bilingual A4 summary PDFs/HTML using local fonts and installed Microsoft Edge; add `-- --preview` for page images |
| `admin:create` | Create a new administrator |
| `db:start`, `db:migrate`, `db:status` | Local native PostgreSQL, apply migrations and inspect history |
| `db:reset`, `db:import:sqlite` | Deliberate schema reset or supported one-time legacy import |
| `contracts:compile`, `contracts:prepare` | Compile local Solidity and prepare private deployment configuration/public plan |
| `contracts:deploy`, `contracts:verify` | Deployment plan/broadcast and source verification/dry run |
| `test:contracts` | EVM helpers, wallets, balances and indexed-history unit checks |
| `test:compensation` | Pricing and payout math |
| `test:verification` | Source-verification input/state checks |
| `test:distributor` | Distributor behavior, receipts and deployment workflow |
| `test:wallet-auth` | Wallet challenge/signature checks |
| `test:sends` | Send quote/signing/evidence checks |
| `test:db` | Isolated PostgreSQL integrity, migrations, concurrency and import checks |
| `test:ui` | Production browser tests with isolated PostgreSQL |
| `test:onchain` | Isolated PostgreSQL plus local Amoy-simulated EVM/browser workflow |
| `test:connected` | Connected-wallet variant of the local chain/browser workflow |

The checked-in [package.json](../../package.json) is the executable command authority. Test files not named in a dedicated npm script can be run directly with Node's test runner as appropriate, such as `node --test tests/auth-mode.test.mjs tests/referral-tree.test.mjs`.

For a payment-code change, choose the relevant contract/compensation/auth/send suites, database checks, typecheck and build; build before browser suites. Browser configuration uses installed Microsoft Edge, port 3100 and desktop/mobile emulation. The chain/browser harness uses a disposable local EVM and DB rather than sending real Amoy transactions. Dedicated DB/UI runners create isolated PostgreSQL without reading the app's `DATABASE_URL`, unless an explicit disposable `TEST_DATABASE_URL` is supplied. Tests are not an independent security audit.

For documentation-only changes, verify local links, API route coverage and financial examples against code; running database or broadcast commands is unnecessary. No claim in this guide means all suites were executed while writing it.

## 8. Troubleshooting and recovery

| Symptom | Checks and next action |
| --- | --- |
| App cannot start / DB unavailable | Confirm PostgreSQL is running, selected DB exists, URL/SSL/network are valid, then inspect migration status |
| Migration checksum/history mismatch | Restore matching applied files/history; add forward migrations instead of editing applied SQL |
| Wallet login rejects host | Match the exact scheme/host/port with `NUXT_PUBLIC_APP_URL` and restart |
| New member cannot register | Check `registrationOpen`, invite activation/status, wallet address uniqueness and mode |
| Member password login absent/rejected | It is disabled by default; linked external accounts use wallet sign-in. Admins use `/admin/login` |
| Contract unavailable | Check Amoy RPC/80002, deployed code, version 2, token match, authority signer match and server environment |
| Purchase cannot advance | Confirm next level, available configured token, pause state, pending operations and quote expiry/config nonce |
| Purchase pending | Preserve ID/hash; check canonical receipt, confirmations, POL and RPC; allow worker reconciliation before retrying |
| Send pending after replacement | Preserve original/new hashes and inspect sender/nonce/receipt. General send replacement discovery is absent; do not issue another payment blindly |
| Balance unavailable | Check linked address, chain, RPC and token metadata; never substitute legacy credit for an on-chain read |
| Wallet history unavailable/empty | Check private explorer key and Amoy capability. Unavailable is distinct from a valid empty indexed history |
| Legacy deposit still pending | A request creates no credit; inspect authenticated admin receipt review and settlement reference |
| Fee change denied | Require an admin session and the linked current owner; check Amoy/POL and nonce-invalidated quotes |
| Commissions differ from wallet balance | Earnings are historical receipts; token balance reflects current holdings and outgoing transfers. Legacy credits are separate |
| Existing embedded funds missing after link | Linking did not move funds; inspect the original embedded address and recover through its encrypted key/password lifecycle |

For unresolved accounting, compare the original stored purchase/operation, chain receipt, block hash, token events and configured confirmation policy. Use operator reconciliation rather than manually marking an unverified payment successful. Suspend new risky operations or pause contract purchases through the appropriate owner controls when investigation requires it.

## 9. Code references

[Configuration](../../.env.example), [Nuxt runtime](../../nuxt.config.ts), [database adapter](../../server/lib/postgres.ts), [migration runner](../../server/lib/migrations.ts), [migrations](../../database/migrations), [scripts](../../scripts), [test configuration](../../playwright.config.ts), [reconciliation worker](../../server/plugins/referral-reconciliation.ts).
