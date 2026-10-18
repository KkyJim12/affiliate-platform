CREATE TABLE referral_chain_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 15),
  amount BIGINT NOT NULL CHECK (amount = 10000000::BIGINT * (1::BIGINT << (level - 1))),
  chain_id INTEGER NOT NULL CHECK (chain_id = 80002),
  contract_address TEXT NOT NULL CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  token_address TEXT NOT NULL CHECK (token_address ~ '^0x[0-9a-fA-F]{40}$'),
  buyer_address TEXT NOT NULL CHECK (buyer_address ~ '^0x[0-9a-fA-F]{40}$'),
  fee_recipient_address TEXT NOT NULL CHECK (fee_recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
  transaction_hash TEXT NOT NULL UNIQUE CHECK (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  block_number BIGINT,
  block_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, request_key)
);
CREATE UNIQUE INDEX referral_chain_paid_level ON referral_chain_purchases(user_id, level) WHERE status <> 'failed';
CREATE UNIQUE INDEX referral_chain_one_pending ON referral_chain_purchases(user_id) WHERE status = 'pending';

CREATE TABLE referral_chain_allocations (
  purchase_id TEXT NOT NULL REFERENCES referral_chain_purchases(id),
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'bonus', 'platform')),
  depth INTEGER NOT NULL CHECK ((kind = 'platform' AND depth = 0) OR (kind = 'direct' AND depth BETWEEN 1 AND 3) OR (kind = 'bonus' AND depth BETWEEN 1 AND 15)),
  amount BIGINT NOT NULL CHECK (amount > 0),
  recipient_address TEXT NOT NULL CHECK (recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
  recipient_user_id TEXT REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('upline', 'platform_fee', 'missing_upline', 'ineligible_upline')),
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  PRIMARY KEY(purchase_id, kind, depth),
  UNIQUE(purchase_id, log_index)
);
CREATE INDEX referral_chain_recipient ON referral_chain_allocations(recipient_user_id);

CREATE TABLE referral_chain_fee_updates (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  owner_address TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  transaction_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at TEXT NOT NULL,
  UNIQUE(admin_id, request_key)
);
CREATE UNIQUE INDEX referral_chain_one_fee_update ON referral_chain_fee_updates((1)) WHERE status = 'pending';

-- Signed transaction bytes are an outbox, never plaintext wallet private keys.
CREATE TABLE referral_chain_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  operation_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('approval_reset', 'approval', 'purchase', 'fee_update')),
  nonce BIGINT NOT NULL CHECK (nonce >= 0),
  transaction_hash TEXT NOT NULL UNIQUE,
  raw_transaction TEXT NOT NULL CHECK (raw_transaction ~ '^0x[0-9a-fA-F]+$'),
  created_at TEXT NOT NULL,
  UNIQUE(operation_id, stage)
);

ALTER TABLE referral_activations ALTER COLUMN transaction_id DROP NOT NULL;
ALTER TABLE referral_activations ADD COLUMN chain_purchase_id TEXT UNIQUE REFERENCES referral_chain_purchases(id);
ALTER TABLE referral_activations ADD CONSTRAINT referral_activation_payment
  CHECK ((transaction_id IS NOT NULL) <> (chain_purchase_id IS NOT NULL));
