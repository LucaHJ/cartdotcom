CREATE TABLE IF NOT EXISTS phase5_local_pilot_fences (
  pilot_key TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  source_message_id TEXT NOT NULL,
  dedupe_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('armed','local_claimed','local_processing','local_complete','rolled_back','expired')),
  expires_at TEXT NOT NULL,
  local_lease_owner TEXT,
  local_lease_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT,
  completed_at TEXT,
  rollback_at TEXT,
  rollback_reason TEXT,
  audit_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS phase5_local_pilot_fences_status_expiry_idx
  ON phase5_local_pilot_fences(status, expires_at);

CREATE INDEX IF NOT EXISTS phase5_local_pilot_fences_job_status_idx
  ON phase5_local_pilot_fences(job_id, status);
