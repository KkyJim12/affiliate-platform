-- Operational delivery state survives app restarts and is shared by replicas.
CREATE TABLE database_backup_runs (
  scheduled_date DATE PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending','failed','sent')),
  attempts INTEGER NOT NULL DEFAULT 1,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  filename TEXT,
  sha256 TEXT,
  last_error TEXT
);
