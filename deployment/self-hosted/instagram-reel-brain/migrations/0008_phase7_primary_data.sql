BEGIN;

-- Phase 7 makes this typed schema the local application data authority while
-- retaining D1 as the edge spool/recovery ledger. These tables account for
-- every production D1 surface added after the Phase 3 snapshot.

ALTER TABLE reel_brain.processing_authority ADD COLUMN IF NOT EXISTS generation bigint NOT NULL DEFAULT 0;
ALTER TABLE reel_brain.processing_authority ADD COLUMN IF NOT EXISTS cutover_watermark timestamptz;
ALTER TABLE reel_brain.processing_authority ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE reel_brain.processing_authority ADD COLUMN IF NOT EXISTS audit_json text NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS reel_brain.processing_authority_events (
  id bigint PRIMARY KEY,
  authority_key text NOT NULL,
  generation bigint NOT NULL,
  from_mode text NOT NULL,
  to_mode text NOT NULL,
  watermark timestamptz,
  detail text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.phase5_local_pilot_fences (
  pilot_key text PRIMARY KEY,
  job_id text NOT NULL UNIQUE REFERENCES reel_brain.jobs(id) ON DELETE CASCADE,
  source_message_id text NOT NULL,
  dedupe_key text,
  status text NOT NULL CHECK (status IN ('armed','local_claimed','local_processing','local_complete','rolled_back','expired')),
  expires_at timestamptz NOT NULL,
  local_lease_owner text,
  local_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  rollback_at timestamptz,
  rollback_reason text,
  audit_json text NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS reel_brain.phase5_preintake_arms (
  arm_key text PRIMARY KEY,
  active_slot text NOT NULL,
  sender_id text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('reel','carousel')),
  status text NOT NULL CHECK (status IN ('armed','captured','cancelled','expired','rolled_back')),
  armed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  source_message_id text,
  job_id text REFERENCES reel_brain.jobs(id) ON DELETE SET NULL,
  event_id text,
  rollback_at timestamptz,
  rollback_reason text,
  audit_json text NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS phase5_preintake_arms_one_armed_slot_idx
  ON reel_brain.phase5_preintake_arms(active_slot)
  WHERE status='armed';

CREATE TABLE IF NOT EXISTS reel_brain.retrieval_documents (
  job_id text PRIMARY KEY REFERENCES reel_brain.jobs(id) ON DELETE CASCADE,
  document_version integer NOT NULL,
  title_text text NOT NULL DEFAULT '',
  author_text text NOT NULL DEFAULT '',
  description_text text NOT NULL DEFAULT '',
  instructions_text text NOT NULL DEFAULT '',
  summary_text text NOT NULL DEFAULT '',
  visual_text text NOT NULL DEFAULT '',
  transcript_text text NOT NULL DEFAULT '',
  comments_text text NOT NULL DEFAULT '',
  resource_names_text text NOT NULL DEFAULT '',
  resource_details_text text NOT NULL DEFAULT '',
  claims_text text NOT NULL DEFAULT '',
  content_hash text NOT NULL,
  source_updated_at timestamptz,
  indexed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.retrieval_terms (
  job_id text NOT NULL REFERENCES reel_brain.jobs(id) ON DELETE CASCADE,
  term text NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,term)
);

CREATE INDEX IF NOT EXISTS retrieval_terms_term_idx ON reel_brain.retrieval_terms(term,job_id);

CREATE TABLE IF NOT EXISTS reel_brain.phase7_cutover_state (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.phase7_wake_receipts (
  wake_id text PRIMARY KEY,
  edge_path text NOT NULL,
  received_at timestamptz NOT NULL,
  drained_at timestamptz,
  result jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS reel_brain.phase7_artifact_mirrors (
  object_key text PRIMARY KEY,
  local_path text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  r2_status text NOT NULL CHECK (r2_status IN ('pending','mirrored','failed')),
  r2_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO reel_brain.migration_metadata(migration_name,notes)
VALUES ('0008_phase7_primary_data','Phase 7 typed primary data, event wake, and local-primary artifact tracking.')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
