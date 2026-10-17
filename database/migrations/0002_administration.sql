CREATE TABLE IF NOT EXISTS user_access (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'))
);

CREATE TABLE IF NOT EXISTS payment_reviews (
  transaction_id TEXT PRIMARY KEY REFERENCES wallet_transactions(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reference TEXT,
  note TEXT NOT NULL,
  admin_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_reviews_reference_unique ON payment_reviews(lower(reference));

CREATE TABLE IF NOT EXISTS platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  registration_open INTEGER NOT NULL DEFAULT 1,
  funding_open INTEGER NOT NULL DEFAULT 1,
  support_email TEXT NOT NULL DEFAULT ''
);

INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL
);
