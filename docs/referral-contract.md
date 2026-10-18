# Amoy referral contract

`contracts/ReferralDistributor.sol` collects the configured ERC-20 payment and
distributes 100% in the same transaction. The default app mode is `contract`;
missing blockchain configuration never falls back to internal credits.

## Deploy using .env

1. Run `npm run contracts:prepare`. It compiles both contracts, adds `.env`
   fields, generates a server-only quote authority key if missing, and writes
   `.data/contracts/deployment-plan.json`. Private keys are never printed.
2. Set `REFERRAL_OWNER_ADDRESS` and `REFERRAL_FEE_RECIPIENT_ADDRESS` in `.env`.
   To manage fees inside the app, use your existing admin account's EVM address
   as owner. The owner and fee recipient may differ.
3. Set `REFERRAL_DEPLOYER_PRIVATE_KEY` to a wallet funded with **Amoy test POL**.
   The deployer pays gas; the configured owner receives ownership.
4. Inspect `npm run contracts:deploy`. It prints a public plan with addresses and
   bytecode hashes, without broadcasting.
5. Run `npm run contracts:deploy -- --broadcast`. It verifies chain ID **80002**,
   deploys both contracts, waits for confirmations, and saves
   `NUXT_EVM_TOKEN_ADDRESS` and `NUXT_REFERRAL_CONTRACT_ADDRESS` in `.env`.
6. Restart the application to load addresses and apply the additive migration.
   Existing paid levels, codes and sponsor links are preserved.

Deployment persists signed bytes before broadcast and reuses them on retries.
Artifacts and progress are under ignored `.data/contracts/`. Keep `.env` and
database backups private. The deployment key is not needed by the running app;
the server-only quote authority must match the deployed `quoteSigner`.
Changing owner/fee deployment fields after deployment does not change on-chain
permissions. The owner must sign updates. Ownership transfer uses two steps.

## Mock token and distribution

`AmoyTestUSDT` is **UNXO Test USDT (tUSDT)**, a valueless six-decimal test token,
not real USDT or dollars. It only deploys on Amoy. The owner receives 1,000,000
tUSDT; each wallet may call `faucet()` once for 400,000 tUSDT. All fifteen
purchases cost 327,670 tUSDT together. Members also need test POL for gas.

Level 1 costs 10 tokens; each full-price sequential upgrade doubles, ending at
level 15 for 163,840 tokens. The contract pays 50%, 20%, 10% to uplines 1–3,
another 15% across uplines 1–15 with normalized halving weights, and 5% to the
platform address. Missing/ineligible shares also go to the platform address.
The first three uplines receive both shares. Largest-remainder micro-USDT
rounding conserves exactly 100%, including with 18-decimal tokens.

Supported token precision is 6–18 decimals. Fee-on-transfer tokens, short
deliveries and rebasing during transfer are rejected. A failed payout reverts
**all** purchase transfers and level changes. Separate approvals and network gas
may still cost POL. The distributor retains no purchase funds and has no arbitrary
owner withdrawal. The owner can change fees/signers, pause, and transfer ownership;
the contracts are non-upgradeable.

## Authorization and automatic recovery

Prices/rates are fixed by the contract. The platform attests existing genealogy,
eligibility and legacy levels using EIP-712. The quote signer is trusted for
those facts. Signatures bind buyer, unique ID, next/previous level, fifteen
recipient addresses, fee recipient, configuration nonce, deadline, chain and
contract. Clients cannot substitute recipients. Fee/signer changes invalidate
older quotes. Quotes expire after an hour. Legacy levels bootstrap the first
chain purchase once, without repaying old purchases or converting credit to tokens.

Password confirmation decrypts the existing wallet on the server and authorizes
exact-price approvals and the purchase. USDT zero-first approvals are supported.
The complete nonce-ordered signed batch is persisted before any broadcast. Gas
cannot exceed the maximum POL budget confirmed by the client. No private key is
returned to the browser.

Wallet locks, request keys, one-pending-purchase constraints, contract levels and
signed IDs prevent duplicate purchases. Retrying broadcasts identical bytes.
The UI polls status, and a worker resumes pending operations every 15 seconds,
including after restart or browser close. Gas-price replacements can be located
by signed purchase ID.

Paid levels and activation require a canonical receipt, configured confirmations
(default two), matching buyer/contract/calldata, one completion event and all 19
allocation events. Chain commissions update dashboard earnings without crediting
internal wallet balances. Pending purchases freeze sponsor changes. Timeouts stay
pending; reverted purchases allow a fresh attempt. Deep reorganizations beyond
the chosen confirmation policy require operator reconciliation. Do not change
payment modes or contract addresses while operations are pending.

## Admin and API

Admin Settings shows the owner, fee recipient and confirmed distributions. An
admin whose wallet owns the contract can update the fee recipient with password
confirmation and POL gas. Ordinary settings writes cannot bypass ownership.
Historical ledger payables remain separate.

| Method | Endpoint | Body or response |
| --- | --- | --- |
| GET | `/api/referrals/chain/status` | Contract, token/gas balances, pending purchase |
| GET | `/api/referrals/chain/purchases` | Current account's recent purchases |
| POST | `/api/referrals/chain/purchase` | `{ password, level, requestKey, maxGasFee }` |
| GET | `/api/admin/referrals/status` | Admin status, totals, fee update |
| POST | `/api/admin/referrals/fee` | `{ password, address, requestKey, maxGasFee }` |

`maxGasFee` is a decimal POL string from the displayed budget. Pending writes
return 202 with a transaction hash. Ownership comes from the session. Explicit
`NUXT_REFERRAL_PAYMENT_MODE=ledger` restores compatibility with the older credit
flow; its activation/upgrade routes reject writes in contract mode.

## Verification

Run `npm run test:distributor`, `npm run test:db`, `npm run typecheck`,
`npm run build`, then `npm run test:onchain`. Browser tests use disposable
PostgreSQL and a fresh local Hardhat EVM, never public Amoy.

Contracts use OpenZeppelin [SafeERC20](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20),
[EIP712/ECDSA](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography),
and [Ownable2Step](https://docs.openzeppelin.com/contracts/5.x/api/access).
These tests are not an independent security audit; this workflow is testnet-only.
