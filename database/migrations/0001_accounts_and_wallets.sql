CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  referral_code TEXT NOT NULL UNIQUE,
  sponsor_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS users_sponsor ON users(sponsor_id, created_at);

CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  available BIGINT NOT NULL DEFAULT 0 CHECK (available BETWEEN 0 AND 9007199254740991),
  reserved BIGINT NOT NULL DEFAULT 0 CHECK (reserved BETWEEN 0 AND 9007199254740991)
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  type TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  description TEXT NOT NULL,
  request_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sequence BIGINT GENERATED ALWAYS AS IDENTITY,
  UNIQUE(wallet_id, request_key)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  resets_at BIGINT NOT NULL
);
