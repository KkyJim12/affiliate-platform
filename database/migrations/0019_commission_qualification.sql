-- Preserve all historical credited commissions. New unqualified shares are held.
ALTER TABLE referral_allocations DROP CONSTRAINT referral_allocations_status_check;
ALTER TABLE referral_allocations ADD CHECK(status IN ('credited','payable','held'));
ALTER TABLE referral_allocations DROP CONSTRAINT referral_allocations_check1;
ALTER TABLE referral_allocations ADD CONSTRAINT referral_allocations_payment_check CHECK(
  (status='credited' AND recipient_user_id IS NOT NULL AND transaction_id IS NOT NULL AND recipient_address IS NULL)
  OR (status='held' AND recipient_user_id IS NOT NULL AND transaction_id IS NULL AND recipient_address IS NULL AND kind<>'platform')
  OR (status='payable' AND recipient_user_id IS NULL AND transaction_id IS NULL
    AND recipient_address IS NOT NULL AND recipient_address ~ '^0x[0-9a-fA-F]{40}$'));
CREATE INDEX referral_held_member ON referral_allocations(recipient_user_id) WHERE status='held';
ALTER TABLE referral_chain_allocations ADD COLUMN status TEXT NOT NULL DEFAULT 'credited' CHECK(status IN ('credited','held'));
ALTER TABLE referral_chain_allocations ADD CHECK(status<>'held' OR (kind<>'platform' AND recipient_user_id IS NOT NULL));
CREATE INDEX referral_chain_held_member ON referral_chain_allocations(recipient_user_id) WHERE status='held';
CREATE TABLE referral_commission_releases (
  contract_address TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  recipient_address TEXT NOT NULL,
  amount TEXT NOT NULL CHECK(amount ~ '^[1-9][0-9]{0,77}$'),
  PRIMARY KEY(transaction_hash,log_index)
);
-- Durable signed relayer outbox for qualification outside a purchase (for
-- example, an already-paid member attaching their sponsor later).
CREATE TABLE referral_qualification_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  contract_address TEXT NOT NULL,
  token_address TEXT NOT NULL,
  payload JSONB NOT NULL,
  raw_transaction TEXT NOT NULL,
  transaction_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX referral_qualification_one_pending ON referral_qualification_transactions(status) WHERE status='pending';
