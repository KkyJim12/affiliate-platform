CREATE TABLE evm_sends (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT,
  chain_id INTEGER NOT NULL CHECK (chain_id = 80002),
  sender_address TEXT NOT NULL CHECK (sender_address ~ '^0x[0-9a-fA-F]{40}$'),
  token_address TEXT CHECK (token_address ~ '^0x[0-9a-fA-F]{40}$'),
  payload JSONB NOT NULL,
  quote_hash TEXT NOT NULL CHECK (quote_hash ~ '^0x[0-9a-fA-F]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('quoted','pending','confirmed','failed')),
  raw_transaction TEXT,
  transaction_hash TEXT UNIQUE CHECK (transaction_hash ~ '^0x[0-9a-fA-F]{64}$'),
  block_number BIGINT,
  block_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, request_key),
  CHECK ((status = 'quoted' AND raw_transaction IS NULL AND transaction_hash IS NULL AND request_key IS NULL)
    OR (status <> 'quoted' AND raw_transaction IS NOT NULL AND transaction_hash IS NOT NULL AND request_key IS NOT NULL))
);
CREATE UNIQUE INDEX evm_sends_one_pending ON evm_sends(user_id) WHERE status = 'pending';
CREATE INDEX evm_sends_history ON evm_sends(user_id, created_at DESC);
