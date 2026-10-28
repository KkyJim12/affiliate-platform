# Binary matrix and unilevel payments (distribution version 3)

Level 1 costs 10 token units. Each subsequent level doubles, up to level 15.
Members can purchase the next level themselves or receive a wallet-funded
automatic upgrade after completing a paid matrix. The supplied deployment uses
Amoy test tokens.

## Trees and slots

The two programs use distinct placement trees. The inviter (`users.sponsor_id`)
remains unchanged when an invitation spills over beneath another member.

- **Binary matrix:** two children per slot, three descendant rows (2 + 4 + 8
  positions), four rows including the owner. Each purchase level has its own
  slots. Extra invitations search the inviter's slots in cycle order, breadth
  first, left before right. When all three rows are occupied, another slot opens
  at the same purchase level. A new slot starts a separate cycle.
- **Unilevel:** two children per member with continuous breadth-first spillover.
  Payments and the tree view cover fifteen ancestors, starting with the buyer's
  placement parent. This tree continues through matrix cycle boundaries.

Registration reserves positions at all levels. A position is locked until its
owner purchases that level. It does not earn that level's commissions while
locked. A registered member is not counted as a paid completion until unlocked.
Slots at previously purchased levels stay unlocked.

The tree component provides program, purchase-level and matrix-cycle selectors.
`GET /api/referrals/tree?id=<numeric ID>&mode=matrix&level=1&cycle=0` displays a
matrix; `mode=unilevel&levels=15` displays continuous placement. Paths contain
only `0` and `1` separated by `/`. The public endpoint returns numeric member
IDs and placement, without internal identifiers, wallets or payment eligibility.

## Purchase distribution

Every purchase transfers the full price in nineteen allocations:

| Program | Recipient | Share |
| --- | --- | ---: |
| Matrix | Parent slot, one step above the buyer | 10% |
| Matrix | Two steps above the buyer | 20% |
| Matrix | Three steps above the buyer | 50% |
| Unilevel | Each of fifteen placement ancestors, starting at the parent | 1% each |
| Platform | Configured fee recipient | 5% |

A recipient must own the purchased level, have an active account and have a
wallet for the current payment mode. Missing or locked shares go to the
platform. Missing depths are never combined into another member's payment.
Eligibility is snapshotted when the server signs the quote.

Matrix and unilevel ancestry can differ, so the signature binds **eighteen**
recipient positions: three matrix addresses followed by fifteen unilevel
addresses. The same wallet can receive one share from each program. Repeated
wallets within one program, self-payments and contract recipients are rejected.

For a 10-token purchase with only the parent eligible in both trees, the parent
receives 1.10 tokens (1.00 matrix + 0.10 unilevel) and the platform receives 8.90.
With all recipients eligible, members receive 9.50 total and the platform 0.50.

## Completion and automatic upgrade

When the owner and all fourteen descendant slots are unlocked at a level, the
backend records that cycle's completion once and ensures another same-level
slot exists. It queues one purchase of the next level. Level 15 recycles without
queuing level 16. If a member has already bought the next level, the queue entry
is superseded without a further charge.

The upgrade costs the **full next-level price**, deducted from the member's
wallet; commissions are not withheld or reserved. A confirmed upgrade unlocks
the next level's slot and distributes its price using the same rules.

In contract mode the purchase confirmation offers a finite token approval for
this and the remaining levels. At level 1 the maximum is 327,670 tokens; this is
an approval ceiling, not an immediate charge. Without this option, the purchase
approves only its own price. Existing allowances can be revoked in the wallet.
An insufficient balance or allowance leaves the upgrade queued. Replenishing
the wallet allows an already-approved upgrade to retry. No member private key
is required in connected-wallet mode.

The quote authority attests the completed cycle using a signed `matrixCycle`
hash. `autoUpgrade` accepts a relayer, checks the quote and sequential level,
and consumes the cycle hash once. A failed transfer reverts all state and
payouts, including cycle consumption. A dedicated quote authority remains
trusted for placement, paid-level eligibility, legacy levels **and cycle
completion**; those facts live in PostgreSQL, not in on-chain tree storage.

The existing 15-second worker persists signed relayer transactions before
broadcast and serializes the relayer nonce across instances. Fund the public
`quoteSigner()` address with Amoy POL for automatic-upgrade gas. The relayer
pays gas; members pay the approved token price. Pending transactions survive
restart and are replayed as the same signed bytes. Suspended accounts do not
start new automatic upgrades. A submitted transaction cannot be cancelled by a
later off-chain suspension.

Embedded ledger mode deducts available credit and creates ledger allocations
instead. Those platform payables are accounting records, not token transfers.

## Existing installation and deployment

Migration `0013_matrix_slots_and_auto_upgrades.sql` adds matrix slots and durable
upgrade jobs, reconstructs placement in registration order and preserves paid
levels. Historical payments and sponsor IDs are unchanged. Pre-existing full
matrices do not trigger retrospective automatic charges. Existing confirmed
version-1 and version-2 receipts retain their original accounting rules.

The distributor is not upgradeable. Updating application source cannot change
an existing deployment. Finish pending purchases before changing addresses. To
retain the existing token and balances:

```sh
npm run contracts:deploy -- --replace-distributor
npm run contracts:deploy -- --replace-distributor --previous-contract <CURRENT_DISTRIBUTOR_ADDRESS> --broadcast
```

The first command prepares a public replacement plan without broadcasting. The
second deploys the reviewed replacement. Restart the app to load its address
and apply the migration. Version 3 refuses quotes for older distributions.
Token allowances belong to each distributor address, so members must approve
the replacement before it can debit tokens. The old owner can pause the old
contract after pending purchases finish.

During the read-only check on 28 October 2026, the locally configured distributor
reported version 2 and the latest five recorded purchase quotes contained only
zero recipient addresses. Such quotes intentionally send all nineteen shares
to the platform. Version 3 prepares recipients from the two placement trees;
if no ancestor has unlocked the purchased level, a full platform payment is
still the defined result.

Validation covers price conservation, 6/18-decimal token transfers, separate
ancestry, locked slots, three-row spillover, recycling, duplicate completion,
late sponsor attachment, wallet debits and replay protection. These changes do
not constitute an independent contract audit.
