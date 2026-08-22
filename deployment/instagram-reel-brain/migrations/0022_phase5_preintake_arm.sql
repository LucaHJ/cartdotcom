CREATE TABLE IF NOT EXISTS phase5_preintake_arms (
  arm_key TEXT PRIMARY KEY,
  active_slot TEXT NOT NULL DEFAULT 'phase5-next-reel',
  sender_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('reel')),
  status TEXT NOT NULL CHECK (status IN ('armed','captured','cancelled','expired','rolled_back')),
  armed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  source_message_id TEXT,
  job_id TEXT,
  event_id TEXT,
  rollback_at TEXT,
  rollback_reason TEXT,
  audit_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS phase5_preintake_arms_one_active_idx
  ON phase5_preintake_arms(active_slot)
  WHERE status='armed';

CREATE INDEX IF NOT EXISTS phase5_preintake_arms_sender_status_idx
  ON phase5_preintake_arms(sender_id, status, expires_at);

CREATE INDEX IF NOT EXISTS phase5_preintake_arms_job_idx
  ON phase5_preintake_arms(job_id);
