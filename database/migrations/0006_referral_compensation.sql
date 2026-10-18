ALTER TABLE platform_settings ADD COLUMN fee_recipient_address TEXT NOT NULL DEFAULT ''
  CHECK (fee_recipient_address = '' OR (fee_recipient_address ~ '^0x[0-9a-fA-F]{40}$'
    AND lower(fee_recipient_address) <> '0x0000000000000000000000000000000000000000'));

-- Existing activations remain level 1. Historical purchases are never repaid.
CREATE TABLE referral_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 15),
  amount BIGINT NOT NULL CHECK (amount = 10000000::BIGINT * (1::BIGINT << (level - 1))),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES wallet_transactions(id),
  fee_recipient_address TEXT NOT NULL CHECK (fee_recipient_address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at TEXT NOT NULL,
  UNIQUE (user_id, level)
);

CREATE TABLE referral_allocations (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES referral_purchases(id),
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'bonus', 'platform')),
  depth INTEGER NOT NULL CHECK ((kind = 'platform' AND depth = 0)
    OR (kind = 'direct' AND depth BETWEEN 1 AND 3)
    OR (kind = 'bonus' AND depth BETWEEN 1 AND 15)),
  amount BIGINT NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
  recipient_user_id TEXT REFERENCES users(id),
  recipient_address TEXT,
  transaction_id TEXT UNIQUE REFERENCES wallet_transactions(id),
  status TEXT NOT NULL CHECK (status IN ('credited', 'payable')),
  reason TEXT NOT NULL CHECK (reason IN ('upline', 'platform_fee', 'missing_upline', 'ineligible_upline')),
  CHECK ((status = 'credited' AND recipient_user_id IS NOT NULL AND transaction_id IS NOT NULL AND recipient_address IS NULL)
    OR (status = 'payable' AND recipient_user_id IS NULL AND transaction_id IS NULL
      AND recipient_address IS NOT NULL AND recipient_address ~ '^0x[0-9a-fA-F]{40}$')),
  UNIQUE (purchase_id, kind, depth)
);

CREATE INDEX referral_allocations_recipient ON referral_allocations(recipient_address) WHERE status = 'payable';
CREATE INDEX referral_purchases_user ON referral_purchases(user_id, level DESC);
