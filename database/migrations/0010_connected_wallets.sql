-- Embedded keystores are retained untouched for a future embedded-wallet mode.
CREATE TABLE connected_wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  address TEXT NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id INTEGER NOT NULL DEFAULT 80002 CHECK (chain_id = 80002),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX connected_wallet_address ON connected_wallets(lower(address));
CREATE TABLE wallet_challenges (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','link')),
  user_id TEXT REFERENCES users(id),
  message TEXT NOT NULL,
  sponsor_code TEXT NOT NULL DEFAULT '',
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT,
  CHECK ((purpose = 'link') = (user_id IS NOT NULL))
);
ALTER TABLE referral_chain_purchases DROP CONSTRAINT referral_chain_purchases_status_check;
ALTER TABLE referral_chain_purchases ADD CONSTRAINT referral_chain_purchases_status_check
  CHECK (status IN ('awaiting_signature','pending','confirmed','failed'));
ALTER TABLE referral_chain_purchases ALTER COLUMN transaction_hash DROP NOT NULL;
ALTER TABLE referral_chain_purchases ADD COLUMN signing_mode TEXT NOT NULL DEFAULT 'embedded'
  CHECK (signing_mode IN ('embedded','external'));
DROP INDEX referral_chain_one_pending;
CREATE UNIQUE INDEX referral_chain_one_pending ON referral_chain_purchases(user_id)
  WHERE status IN ('awaiting_signature','pending');
ALTER TABLE referral_chain_allocations DROP CONSTRAINT referral_chain_allocations_reason_check;
ALTER TABLE referral_chain_allocations ADD CONSTRAINT referral_chain_allocations_reason_check
  CHECK (reason IN ('upline','platform_fee','missing_upline','ineligible_upline','highest_upline'));
-- Server prepares intents; connected wallets supply the signed transaction hash.
CREATE TABLE external_wallet_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('send','fee')),
  payload JSONB NOT NULL,
  transaction_hash TEXT UNIQUE CHECK (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  status TEXT NOT NULL DEFAULT 'awaiting_signature' CHECK (status IN ('awaiting_signature','pending','confirmed','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,request_key)
);
