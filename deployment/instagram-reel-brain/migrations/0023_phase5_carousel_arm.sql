CREATE TABLE phase5_preintake_arms_v2 (
  arm_key TEXT PRIMARY KEY,
  active_slot TEXT NOT NULL DEFAULT 'phase5-next-share',
  sender_id TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('reel','carousel')),
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

INSERT INTO phase5_preintake_arms_v2(
  arm_key,active_slot,sender_id,media_type,status,armed_at,expires_at,
  consumed_at,source_message_id,job_id,event_id,rollback_at,rollback_reason,
  audit_json,created_at,updated_at
)
SELECT
  arm_key,'phase5-next-share',sender_id,media_type,status,armed_at,expires_at,
  consumed_at,source_message_id,job_id,event_id,rollback_at,rollback_reason,
  audit_json,created_at,updated_at
FROM phase5_preintake_arms;

DROP TABLE phase5_preintake_arms;
ALTER TABLE phase5_preintake_arms_v2 RENAME TO phase5_preintake_arms;

CREATE UNIQUE INDEX phase5_preintake_arms_one_active_idx
  ON phase5_preintake_arms(active_slot)
  WHERE status='armed';

CREATE INDEX phase5_preintake_arms_sender_status_idx
  ON phase5_preintake_arms(sender_id, status, expires_at);

CREATE INDEX phase5_preintake_arms_job_idx
  ON phase5_preintake_arms(job_id);
