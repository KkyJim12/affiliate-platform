# Binary matrix and unilevel payments (distribution version 3)

[ภาษาไทย](th/matrix-payments.md) · [Documentation index](README.md) · [Deploy contracts](en/deploy-contracts.md)

Level 1 costs 10 token units. Each subsequent level doubles, up to level 15.
Members can purchase the next level themselves or receive a wallet-funded
automatic upgrade after completing a paid matrix slot or unilevel tree. The supplied deployment uses
Amoy test tokens.

## Trees and slots

The two programs use distinct placement trees. The inviter (`users.sponsor_id`)
remains unchanged when an invitation spills over beneath another member.

- **Binary matrix:** two children per slot, three descendant rows (2 + 4 + 8
  positions), four rows including the owner. Each purchase level has its own
  slots. Extra invitations search the inviter's slots in cycle order, breadth
  first, left before right. When all three rows are occupied, overflow positions
  are reserved in future cycles. A rebirth opens at the same purchase level only
  after the owner and all fourteen positions purchase that level.
- **Unilevel:** two children per member with continuous breadth-first spillover.
  Payments and the tree view cover fifteen ancestors, starting with the buyer's
  placement parent. This tree continues through matrix cycle boundaries.
  A full fifteen-row binary tree contains 65,534 descendants; its owner and
  every descendant must own the same purchase level to complete it.

Registration reserves positions at all levels. A position is locked until its
owner purchases that level. It does not earn that level's commissions while
locked. A registered member is not counted as a paid completion until unlocked.
Slots at previously purchased levels stay unlocked.

For example, User 2 in the first row of User 1's matrix views the same connected
branch from User 2's own slot. Once User 1's 2/4/8 rows are paid, User 2 has two
inherited rows (2 + 4 members) and eight empty positions in their third row.
User 2 or their placed downline can fill those positions. Extra invitations
from User 1 enter User 1's rebirth instead. Completing User 2's slot opens User
2's own rebirth and queues their next unowned level. After the wallet-funded
upgrade confirms, User 2's reserved position in User 1's next-level matrix
is marked as purchased. Members who have not bought that level remain visible
with a "Not purchased yet" tag.

The member referral page starts with a grid of matrix slots, including initial
slots and rebirths at every purchase level. Cards show locked, filling or
completed status, paid positions and reserved positions separately. Select a
card to open that exact level and cycle, then return to the grid to choose
another. The level filter and pagination support accounts with many rebirths.
Locked cards preview reserved placement; opening one does not purchase a level.
Every matrix level, including level 1, shows referred members when they join.
Members who have not purchased the selected level carry a "Not purchased yet"
tag. Tree counts show paid
positions. Registration alone does not open a rebirth or trigger an upgrade.
Reserved future cycles stay out of the slot list and public cycle selector
until the preceding cycle completes with all fourteen positions and its owner paid.

The owner's root remains visible for context. Unpaid parents and their
connections remain visible at every level, so descendants retain their original
paths. The open slot refreshes every fifteen seconds while the tab is visible.
Opening a completed card shows all fourteen members in that exact level and
cycle, even after later rebirths; the new slot has its own separate tree.
Unilevel and the member list remain separate views on the same page.

`GET /api/referrals/slots?level=1&page=1` returns the signed-in member's own
progress, with at most 24 cards per page. It accepts no other member's identity.
The public tree component provides program, purchase-level and cycle selectors.
`GET /api/referrals/tree?id=<numeric ID>&mode=matrix&level=1&cycle=0` displays a
matrix; `mode=unilevel&levels=15` displays continuous placement. Paths contain
only `0` and `1` separated by `/`. The public endpoint returns numeric member
IDs, placement and a `purchased` boolean on each member and root, without internal
identifiers or wallets. In matrix mode `purchased` refers to the selected level;
in unilevel mode it indicates ownership of level 1.

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
backend records that cycle's completion once and opens the next same-level
cycle. This is a **rebirth**: a separate slot at the same level,
with the same two branches and three rows, while the previous slot stays intact.
Each rebirth can fill and complete again.
Prepaid reserved cycles are checked in order when opened; each must satisfy
the same paid completion rule before the following rebirth opens.

Each newly completed matrix slot queues one purchase of the member's next
unowned level, through level 15. For example, completing the first level-1 slot
buys level 2; completing a level-1 rebirth after that buys level 3. Simultaneous
completions reserve distinct successive levels. If the member manually buys a
reserved level first, that job is superseded without a duplicate charge.

The unilevel tree completes once per paid level when its owner and all 65,534
descendants within fifteen rows own that level. It queues the next unowned level
through the same worker. Unilevel does not create rebirth slots or move members.
Neither program purchases level 16; matrix rebirths continue at the maximum.

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

The quote authority attests either program's completion using a signed `matrixCycle`
hash. `autoUpgrade` accepts a relayer, checks the quote and sequential level,
and consumes the cycle hash once. A failed transfer reverts all state and
payouts, including cycle consumption. A dedicated quote authority remains
trusted for placement, paid-level eligibility, legacy levels **and cycle
completion**; those facts live in PostgreSQL, not in on-chain tree storage.
The field name remains compatible with version 3: matrix proofs hash the slot
ID, while unilevel proofs hash `unilevel:<paid level>:<member UUID>`.

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

Migration `0014_unilevel_completion_and_rebirth.sql` preserves existing jobs in
the shared `referral_auto_upgrades` queue, adds incremental unilevel progress,
and records historical full unilevel trees without retrospective charges.
`matrix_auto_upgrades` remains a matrix-only compatibility view. A payment
updates at most fifteen unilevel ancestors instead of scanning 65,534 members.
This application update uses the existing version-3 contract ABI and requires
no replacement if the configured distributor already reports version 3.

Migration `0015_paid_matrix_rebirths.sql` separates reserved overflow from opened
rebirths. It preserves placement, completed cycles and payment evidence while
hiding future unqualified cycles. Apply it with the application update below.

For an existing version-3 installation:

```sh
npm run db:migrate
npm run build
```

Restart the application using its existing environment. Startup also applies
pending migrations. The replacement instructions below apply to older contract
versions; they are not required for this completion and rebirth update.

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
