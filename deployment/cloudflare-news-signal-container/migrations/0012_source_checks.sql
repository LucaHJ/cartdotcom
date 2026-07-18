CREATE TABLE IF NOT EXISTS source_checks (
  id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  acquired_count INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  failed_source_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_source_checks_checked_at
ON source_checks(checked_at DESC);
