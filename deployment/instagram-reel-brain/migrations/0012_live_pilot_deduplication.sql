ALTER TABLE jobs ADD COLUMN dedupe_key TEXT;
ALTER TABLE jobs ADD COLUMN pilot_run_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_key_unique_idx
  ON jobs(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_pilot_run_idx ON jobs(pilot_run_id, status);

CREATE TABLE IF NOT EXISTS pilot_runs (
  id TEXT PRIMARY KEY,
  pilot_key TEXT NOT NULL UNIQUE,
  target_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'selecting',
  selected_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  unavailable_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pilot_items (
  id TEXT PRIMARY KEY,
  pilot_run_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  source_url TEXT,
  shortcode TEXT,
  job_id TEXT,
  decision TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(pilot_run_id, source_message_id),
  FOREIGN KEY(pilot_run_id) REFERENCES pilot_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS pilot_items_run_decision_idx
  ON pilot_items(pilot_run_id, decision, created_at);
