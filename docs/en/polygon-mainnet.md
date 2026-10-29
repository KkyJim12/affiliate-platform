# Polygon mainnet deployment and application

The application supports Polygon mainnet (137) and Amoy (80002). Use a separate
environment and PostgreSQL database for each network. Mainnet uses the existing
six-decimal Polygon USDT contract, now branded USDT0:

`0xc2132D05D31c914a87C6611C10748AEb04B58e8F`

Sources: [USDT0's Polygon contract address](https://usdt0.to/ecosystem/polygon)
and [Polygon network details](https://docs.polygon.technology/pos/reference/rpc-endpoints).

## Configuration

Copy `.env.mainnet.example` to `.env.mainnet`, or run:

```powershell
npm.cmd run contracts:mainnet:prepare
```

Preparation creates missing mainnet defaults and a server-only quote authority
key when no signer is configured. It compiles only `ReferralDistributor`.
It never deploys, mints or compiles the Amoy mock token for mainnet.

Set the owner, fee recipient and deployer key in `.env.mainnet`. The owner can
be a multisig. The quote signer must be a signing key controlled by the server;
its public address can also be supplied as `REFERRAL_QUOTE_SIGNER_ADDRESS` for
keyless plan preparation. A running application needs the authority private key
matching the deployed quote signer. These keys stay server-side.

Set `NUXT_PUBLIC_APP_URL` to the application's exact origin. Set both
`NUXT_PUBLIC_CHAIN_ID=137` and `NUXT_EVM_CHAIN_ID=137`. Use contract payments
and the pinned USDT address. The runtime rejects a different mainnet token,
inconsistent chain settings and ledger payment mode.

## Review and deploy

```powershell
npm.cmd run contracts:mainnet:deploy
```

This reads the RPC chain, token bytecode and decimals, estimates deployment gas,
and writes `.data/contracts/polygon-mainnet/deployment-plan.json`. Check the
owner, fee recipient, signer, `missing`, `gasBudgetPol`, `withinGasLimit` and
`funded`. The deployer needs mainnet POL; it needs no USDT to deploy.
`MAINNET_MAX_DEPLOYMENT_COST_POL` caps the transaction's maximum gas cost.

```powershell
npm.cmd run contracts:mainnet:deploy -- --broadcast
```

Only one contract is deployed: the distributor with the existing USDT payment
token. The script persists its signed transaction before broadcasting, waits
for the configured confirmations, checks the resulting contract state, and
updates `.env.mainnet`. Run the same command to resume an interrupted deployment.
A confirmed deployment is reused on retry. Changed constructors, bytecode,
networks or token addresses cannot silently reuse its progress.
Concurrent broadcasts are blocked by `deployment.lock`. If a process is killed,
inspect that file's process ID and saved transaction before removing a stale
lock, then run the same command to resume.

Amoy configuration and artifacts stay in `.env` and `.data/contracts`;
mainnet progress, build and verification files stay in the `polygon-mainnet`
subdirectory. Keep those records for recovery and source verification.

## Verify source

```powershell
npm.cmd run contracts:mainnet:verify -- --dry-run
npm.cmd run contracts:mainnet:verify
```

The first command prepares Standard JSON and original constructor arguments.
The second uses `ETHERSCAN_API_KEY` (or `NUXT_EVM_EXPLORER_API_KEY`) to verify
only your distributor on chain 137. The existing USDT contract is not submitted.
Verification saves accepted request IDs so a later run can resume them.

## Start the mainnet application

Create a dedicated PostgreSQL database and put its URL in `.env.mainnet`.
The migration records the database's network. An Amoy database containing paid
levels, activations, wallets or transaction evidence cannot become a mainnet
database by changing environment variables. Mainnet rows also reject Amoy
chain IDs at the database layer.

```powershell
npm.cmd run db:mainnet:migrate
npm.cmd run admin:mainnet:create
npm.cmd run build:mainnet
npm.cmd run start:mainnet
```

For local development, use `npm.cmd run dev:mainnet`. The production start
command loads `.env.mainnet` directly; configure the same values in a hosted
runtime. Wallet chain switching, sign-in messages, purchase signatures,
approvals, transfers, receipt checks, balances and explorer links follow chain
137. English and Thai network descriptions identify real mainnet USDT0.

Members fund their wallets with Polygon USDT0 and approve the new distributor.
Fund the quote signer with POL if automatic upgrades are enabled; the relayer
pays upgrade gas, while members pay approved token prices.

## Validation

```powershell
npm.cmd run test:mainnet
npm.cmd run test:db
npm.cmd run test:mainnet:app
```

These use fresh local simulations and disposable databases. The chain-137 test
fixture installs an ERC-20 at the canonical address only inside localhost; the
production deployment always checks the real chain and existing token.
