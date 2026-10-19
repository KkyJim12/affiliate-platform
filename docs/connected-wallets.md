# Connected wallets

`NUXT_PUBLIC_WALLET_MODE=external` is the default. MetaMask, Rabby and Phantom
are discovered through EIP-6963, with injected-provider fallbacks. Use a browser
extension or the wallet's built-in browser. Phantom needs testnet mode enabled
for Polygon Amoy. This integration does not provide QR pairing from a desktop
browser to a separate phone.

Set `NUXT_PUBLIC_APP_URL` to the exact application origin, including the port
when needed. Production wallet login rejects missing canonical-origin
configuration or a different host; localhost development can omit this setting.

Sign-in requests a five-minute, single-use Ethereum message containing the
origin, address, chain ID, random nonce and expiry. The server recovers the signer
and atomically consumes the challenge. Unknown wallets create member accounts;
only active invite codes establish sponsors. Registration controls also apply to
new wallet accounts. Sessions retain the existing HttpOnly cookie protections.

Username/password login is hidden and blocked by default for both members and
administrators (`NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED=false`). MetaMask, Rabby and
Phantom wallet signatures are the available login method. Existing linked admin
wallets retain their administrator access; new wallets create member accounts.

To enable legacy login later, set `NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED=true` and
restart the app. Existing members and administrators can then choose **Already
have a username account?**, sign in with their existing credentials once, and
link a wallet in the wallet page or admin contract panel. Linking also requires
a wallet signature. It preserves the account ID, sponsor, levels and history.
Once linked, password login remains disabled for that account in external mode.
Set the flag back to `false` and restart when migration is complete. A linked
wallet cannot be replaced or shared with another account through the public API.
EOA message signatures are supported; contract-account/EIP-1271 login is not
implemented.

Existing encrypted keystores and ledger records remain in PostgreSQL. Linking an
external wallet does **not** move funds from an old address or convert internal
credits to tokens. Preserve database backups and arrange any required old-wallet
fund recovery before switching users. To intentionally restore the retained
embedded wallet UI and server signing, set `NUXT_PUBLIC_WALLET_MODE=embedded`
and `NUXT_PUBLIC_PASSWORD_LOGIN_ENABLED=true`, then restart. Legacy internal-credit
purchases additionally require
`NUXT_REFERRAL_PAYMENT_MODE=ledger`. External mode always uses contract payments.
The retained embedded flow uses legacy account passwords. Wallet-only accounts
have no usable password; offering them embedded wallets later also needs a
password-setup migration.

## Transaction approval

The server returns unsigned transactions. The selected wallet signs and sends
each ERC-20 approval, purchase, transfer and administrator fee change. No buyer
private key or password reaches the external transaction flow. The server's
quote authority signs only purchase eligibility and genealogy, which cannot
spend a buyer's tokens without the buyer's own transaction.

Purchases approve only the exact price, using a zero-first reset when needed.
Purchase preparation reads token balance and allowance without checking POL
balance or requiring a gas quote. The wallet reviews the network fee. The
contract executes the purchase and every allocation atomically. Activation and
accounting wait for canonical receipts and configured confirmations.

Prepared purchases are persisted before signing. Retries reuse the pending
authorization; receipt recovery can find a replaced transaction or recover after
the browser closes, using its signed purchase ID. Expired unused quotes release
the level after chain confirmation of expiry. Public transaction hashes for
transfers and fee updates are retained in browser storage until the server
acknowledges them; open the same browser and refresh to retry tracking after an
interrupted submission. Neither this storage nor the backend stores external
wallet private keys. Keep the original hash if a wallet replaces a transfer:
automatic transfer replacement discovery is not implemented.

## Distribution version 2

The direct allocations remain 50%, 20%, 10% for depths 1–3. Each bonus depth
1–15 receives exactly 1% of the purchase; these overlap the direct allocations.
The base platform fee remains 5%.

Unused **trailing** bonus depths pay the highest eligible upline. For five
eligible uplines, depths 1–4 each receive 1% bonus and depth 5 receives 11%.
Ineligible gaps below the highest eligible upline and missing direct allocations
go to the platform. When no upline is eligible, the entire 15% bonus goes to the
platform fee recipient. Confirmed redirected top-upline payments appear as that
member's commission, with `highest_upline` accounting reasons.

The existing contract is not upgradeable. The application refuses new purchases
through a distributor that does not report `distributionVersion() == 2`.
Existing pending purchases can still be receipt-verified under their original
distribution rules; settle pending operations before a deployment change.

To replace only the distributor while retaining the existing token and balances:

1. Back up `.env`, PostgreSQL and `.data/contracts`. Set
   `REFERRAL_OWNER_ADDRESS` to the externally controlled owner wallet, check the
   platform recipient and quote authority, and fund the deployer with test POL.
   Use a dedicated quote authority; the external owner's key belongs in its
   wallet rather than the server configuration.
2. Review `npm run contracts:deploy -- --replace-distributor`. It compiles the
   updated code and writes `.data/contracts/replacement-plan.json` without sending
   a transaction.
3. After reviewing the concrete addresses and deployment, run
   `npm run contracts:deploy -- --replace-distributor --previous-contract <CURRENT_DISTRIBUTOR_ADDRESS> --broadcast`.
   The explicit old address prevents accidental duplicate replacement. The
   command checks the existing token and deploys only the new distributor,
   preserving the original deployment record and saving replacement progress.
4. Restart the server to load the new distributor address and apply migration
   `0010_connected_wallets.sql`. No database reset is required. Verify sources
   with `npm run contracts:verify -- --dry-run`, then normal verification.

This workflow has been tested against a disposable local Amoy simulation. Running
the replacement command is a separate deployment action; source changes alone
do not alter an already-deployed contract.

## Endpoints

- `POST /api/auth/wallet/challenge`: `{address, purpose?: "login" | "link", sponsorCode?}`.
  Returns `{id,message}`. Linking requires an authenticated existing account.
- `POST /api/auth/wallet/verify`: `{id,signature}`; returns `{user}` and a session.
- `POST /api/referrals/chain/prepare`: `{level,requestKey}`; returns purchase
  status and unsigned nonce-independent approval/purchase calls.
- `POST /api/referrals/chain/confirm`: `{id,transactionHash}`; checks sender,
  target, calldata, chain and value before tracking canonical purchase evidence.
- `POST /api/wallet/connected/send`: `{asset,recipient,amount,requestKey}`;
  returns a reviewable unsigned transfer intent.
- `POST /api/admin/referrals/prepare-fee`: `{address,requestKey}`; admin-only,
  and the linked wallet must own the configured distributor.
- `POST /api/wallet/connected/confirm`: `{id,transactionHash}`; tracks a transfer
  or fee intent belonging to the current account.
- `GET /api/wallet/connected/operations`: recent operation status, with receipt
  reconciliation. Existing balance, wallet history and purchase status APIs read
  the account's linked address.

All writes require a matching Origin and are rate limited. Custodial create,
reveal and signing endpoints, internal transfers and ledger purchases are blocked
in external mode. Restoring legacy login and registration also requires the
password-login flag described above.

## Validation

`npm run test:connected` starts disposable local PostgreSQL and an Amoy EVM
simulation, tests authentication and recovery, and supplies mock EIP-1193 wallet
providers to real browser pages. Wallet keys exist only in the test harness.
`npm run test:distributor`, `npm run test:db`, `npm run typecheck` and
`npm run build` cover contract allocations, deployment, schema and compilation.
