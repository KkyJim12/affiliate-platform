CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS wallet_transactions_wallet_created ON wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_transactions_type_status_created ON wallet_transactions(type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_created ON admin_audit(created_at DESC);
