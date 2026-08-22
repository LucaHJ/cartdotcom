BEGIN;

CREATE TABLE IF NOT EXISTS reel_brain.phase5_pilot_leases (
  pilot_key text PRIMARY KEY,
  exact_job_id text NOT NULL UNIQUE REFERENCES reel_brain.jobs(id) ON DELETE CASCADE,
  source_message_id text NOT NULL,
  cloud_fence_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('armed','leased','processing','completed','rolled_back','expired')),
  lease_owner text,
  lease_acquired_at timestamptz,
  lease_heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  expires_at timestamptz NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  audit_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  rollback_at timestamptz,
  rollback_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS phase5_pilot_leases_one_active_idx
  ON reel_brain.phase5_pilot_leases((true))
  WHERE status IN ('armed','leased','processing');

CREATE INDEX IF NOT EXISTS phase5_pilot_leases_job_status_idx
  ON reel_brain.phase5_pilot_leases(exact_job_id, status);

CREATE TABLE IF NOT EXISTS reel_brain.phase5_pilot_events (
  id bigserial PRIMARY KEY,
  pilot_key text NOT NULL REFERENCES reel_brain.phase5_pilot_leases(pilot_key) ON DELETE CASCADE,
  job_id text NOT NULL REFERENCES reel_brain.jobs(id) ON DELETE CASCADE,
  stage text NOT NULL,
  status text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO reel_brain.migration_metadata (migration_name, notes)
VALUES ('0005_phase5_controlled_pilot', 'Phase 5 one-job controlled compute pilot lease tables only; local authority remains disabled by processing_authority.')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
