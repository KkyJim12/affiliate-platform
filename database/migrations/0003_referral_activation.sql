CREATE TABLE IF NOT EXISTS referral_activations (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  transaction_id TEXT NOT NULL UNIQUE REFERENCES wallet_transactions(id),
  created_at TEXT NOT NULL
);
