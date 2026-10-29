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
- **Unilevel:** two children per slot with breadth-first spillover at each purchase level.
  Payments and the tree view cover fifteen ancestors, starting with the buyer's
  placement parent. Its slots and rebirths are independent of matrix cycles.
  A full fifteen-row binary tree contains 65,534 descendants; its owner and
  every descendant must own the same purchase level to complete it.

Registration previews level 1 in both programs and creates empty higher-level
cards. Higher-level cards reserve no position. When a member enters a level,
each program searches the original inviter's slots in cycle order, breadth
first, left before right. Entry order determines placement independently at
each level. The member's sponsor ID stays unchanged. An unpaid inviter can
receive descendants in their placeholder slot but cannot earn commissions
until they own that level. Previously purchased levels stay unlocked.

For contract payments, entry is reserved when preparing the signed quote.
That reservation survives confirmation delays and retries so the tree matches
the signed recipients. Failed or expired quotes do not unlock the level.
Ledger reservations roll back if the purchase fails.

For example, User 2 in the first row of User 1's matrix views the same connected
branch from User 2's own slot. Once User 1's 2/4/8 rows are paid, User 2 has two
inherited rows (2 + 4 members) and eight empty positions in their third row.
User 2 or their placed downline can fill those positions. Extra invitations
from User 1 enter User 1's rebirth instead. Completing User 2's slot opens User
2's own rebirth and queues their next unowned level. After the wallet-funded
upgrade enters the next level, User 2 takes the next available position under
User 1 at that level. If another member entered that level first, that member
keeps the earlier position. The level-1 position is not copied to level 2.

The member referral page starts with a grid of matrix slots, including initial
slots and rebirths at every purchase level. Cards show locked, filling or
completed status, paid positions and reserved positions separately. Select a
card to open that exact level and cycle, then return to the grid to choose
another. The level filter and pagination support accounts with many rebirths.
Locked cards preview existing descendants; opening one does not purchase a level.
Level 1 shows referred members when they register. Higher levels show members
when they enter that level.
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
Unilevel and the member list remain separate views on the same page. The
unilevel tree also provides purchase-level and rebirth-cycle selectors.

`GET /api/referrals/slots?level=1&page=1` returns the signed-in member's own
progress, with at most 24 cards per page. It accepts no other member's identity.
The public ID search at `/search?id=<numeric ID>` starts with the same slot
cards for the requested member, including level filtering, pagination and
rebirths. Opening a card shows that exact level and cycle; the Unilevel tab
opens the requested member's unilevel tree. Public cards are read-only and
load from `GET /api/referrals/public-slots?id=<numeric ID>&level=1&page=1`.
This returns numeric member IDs and slot progress without account UUIDs,
wallets, balances or payment records. The authenticated endpoint still uses
the session member regardless of query parameters.
The public tree component provides program, purchase-level and cycle selectors.
`GET /api/referrals/tree?id=<numeric ID>&mode=matrix&level=1&cycle=0` displays a
matrix; `mode=unilevel&level=2&cycle=1&levels=15` displays that exact unilevel slot. Paths contain
only `0` and `1` separated by `/`. The public endpoint returns numeric member
IDs, placement and a `purchased` boolean on each member and root, without internal
identifiers or wallets. In matrix mode `purchased` refers to the selected level;
in unilevel mode it also refers to the selected level.

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

## Two paid direct referrals and held commissions

From distributor version 4, a member needs **two distinct personally referred
members with confirmed paid activations** before receiving member commissions.
This qualification applies across all fifteen levels, both programs, upgrades
and rebirths. It does not reset each cycle. Registrations, spillover placements,
failed or pending payments, and extra purchases by one referral do not count.
Direct referrals come from `users.sponsor_id`, independently of tree placement.

An otherwise eligible member with fewer than two paid direct referrals keeps
their full commission entitlement in `heldCommissions(member)` inside the
distributor. These shares emit `ShareHeld` and are not sent to the platform,
credited to the wallet, or available to fund upgrades or rebirths. Platform fees
and missing, locked or otherwise ineligible upline shares keep their existing
rules. Held balances do not expire or get forfeited by this qualification rule.

The second direct member's first purchase qualifies the sponsor and releases
all previously held commissions automatically in that transaction. Current and
future shares then pay normally. The signed quote binds the original sponsor;
upgrades and rebirths cannot count the same buyer again. Signed qualification
bits also attest existing paid direct referrals from the application database,
including legacy accounts. The quote authority is trusted for these database
facts, as it already is for placement and paid-level eligibility.

For an already-paid account that links a sponsor later, the worker submits a
signed `qualifyCommission` attestation after verifying the two paid referrals.
Its signed transaction is persisted before broadcast and shares the automatic
purchase relayer's nonce lock. Restarts and retries reuse the same transaction.
Failed transfers revert the qualification and all releases. Every release is
recorded once; receipt reconciliation supports out-of-order confirmations.

The member referral page shows the paid referral count and held balance.
Dashboard credited earnings exclude held shares. In ledger mode, equivalent
shares stay in held allocation records and are credited atomically when the
member qualifies. Historical already-paid commissions are not reclaimed.

Apply `0019_commission_qualification.sql`, build and restart the app, and deploy
the updated **version-4 distributor** to enable this rule for token payments.
Existing version-3 deployments cannot implement these holds and will reject new
purchase preparation in this app. Finish their pending purchases before changing
addresses. Historical receipts retain their original verification rules. Token
approval must be granted to the replacement distributor address.

## Completion and automatic upgrade

When the owner and all fourteen descendant slots are unlocked at a level, the
backend records that cycle's completion once and opens the next same-level
cycle. This is a **rebirth**: a separate slot at the same level,
with the same two branches and three rows, while the previous slot stays intact.
The new slot re-enters under the member's original referrer at the next
available position. It does not retain the previous slot's position or become
an isolated root when the member has a referrer. Placement excludes the member's
existing descendant branches to avoid circular ancestry. If eligible positions
are occupied, overflow can reserve a future referrer cycle until it opens.
Each rebirth is a separate payment at the full source-level price: level 1
costs 10 tokens, level 2 costs 20, level 3 costs 40, doubling through level 15.
The member's wallet is debited once, and the price pays the new slot's parent
chain using the existing 10% / 20% / 50% matrix, fifteen 1% unilevel and 5%
platform shares. The other program uses its latest paid, opened slot at this
level. Missing or ineligible parents still pay the platform. The rebirth stays
unpaid until settlement; it cannot count as a paid parent or complete again.
Reserved future cycles also stay unpaid until their own rebirth charges settle.
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
through the same worker and opens its next same-level unilevel slot under the
original referrer. Later level entries follow that slot's fifteen parent steps
at 1% each. Completed unilevel slots keep their existing descendants.
Neither program purchases level 16; matrix rebirths continue at the maximum.

The upgrade waits for its rebirth payment and costs the **full next-level price**, deducted separately from the member's
wallet; commissions are not withheld or reserved. A confirmed upgrade unlocks
the next level's slot and distributes its price using the same rules.

In contract mode the purchase confirmation offers a finite token approval for
this and the remaining levels. At level 1 the maximum is 327,670 tokens; this is
an approval ceiling, not an immediate charge. Without this option, the purchase
approves only its own price. Rebirth payments share this finite approval with
upgrades, so repeated rebirths can require renewed approval. Existing allowances can be revoked in the wallet.
An insufficient balance or allowance leaves the upgrade queued. Replenishing
the wallet allows an already-approved upgrade to retry. No member private key
is required in connected-wallet mode.

Migration `0018_rebirth_payments.sql` enables charges for new completions only;
existing opened cycles and queued upgrades are preserved without retroactive
charges. Contract payments require a newly deployed distributor exposing
`rebirthVersion() == 1`; older version-3 deployments keep rebirth charges queued
with a deployment message. Build and restart the app after migration and update
its contract configuration after deployment. No live deployment is performed by
this source change.

The `rebirth` contract method spends a signed completion once independently
from `autoUpgrade`, charges the source-level price and preserves the buyer's
highest owned level. Failed payments revert all transfers and replay state.
Rebirth quotes hash `rebirth:<completion ID>`, separately from the existing
upgrade proof for that completion.

The quote authority attests either program's completion using a signed `matrixCycle`
hash. `autoUpgrade` accepts a relayer, checks the quote and sequential level,
and consumes the cycle hash once. A failed transfer reverts all state and
payouts, including cycle consumption. A dedicated quote authority remains
trusted for placement, paid-level eligibility, legacy levels **and cycle
completion**; those facts live in PostgreSQL, not in on-chain tree storage.
The field name remains compatible with version 3: matrix proofs hash the slot
ID, while initial unilevel proofs hash `unilevel:<paid level>:<member UUID>`.
Unilevel rebirth proofs hash their slot ID, which also includes the cycle number.

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
Migration 0014 itself uses the version-3 ABI. The paid rebirth behavior added in
0018 requires the additional `rebirth` method and capability described above.

Migration `0015_paid_matrix_rebirths.sql` separates reserved overflow from opened
rebirths. It preserves placement, completed cycles and payment evidence while
hiding future unqualified cycles. Apply it with the application update below.

Migration `0016_dynamic_program_placement.sql` removes unpaid higher-level
reservations, adds per-level unilevel slots, and reconnects opened rebirths.
It preserves paid ancestry, outstanding signed quote reservations, historical
allocations and upgrade jobs. Legacy unpaid parents needed by a paid branch
remain attached. Existing full unilevel trees receive a new cycle without
retroactive wallet charges. The existing version-3 ABI and percentages are
unchanged for migration 0016. Paid rebirths introduced in 0018 require a replacement.

For an existing version-3 installation:

```sh
npm run db:migrate
npm run build
```

Restart the application using its existing environment. Startup also applies
pending migrations. The replacement instructions below also apply to existing
version-3 distributors that do not expose `rebirthVersion() == 1`.

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
