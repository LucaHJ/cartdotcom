BEGIN;

-- Phase 3 keeps the local services disabled, but the non-authoritative shadow
-- import must be able to hold the complete Cloudflare D1 production shape in
-- typed relational tables. These extensions account for drift between the
-- Phase 2 local contract and the live D1 schema without granting processing
-- authority.

ALTER TABLE reel_brain.jobs ALTER COLUMN dedupe_key DROP NOT NULL;
ALTER TABLE reel_brain.jobs ADD COLUMN IF NOT EXISTS upload_token_hash text;
ALTER TABLE reel_brain.jobs ADD COLUMN IF NOT EXISTS upload_token_expires_at timestamptz;
ALTER TABLE reel_brain.jobs ADD COLUMN IF NOT EXISTS audio_title text;
ALTER TABLE reel_brain.jobs ADD COLUMN IF NOT EXISTS audio_artist text;
ALTER TABLE reel_brain.jobs ADD COLUMN IF NOT EXISTS audio_source_url text;
ALTER TABLE reel_brain.jobs ADD COLUMN IF NOT EXISTS audio_identification_method text;
ALTER TABLE reel_brain.jobs ADD COLUMN IF NOT EXISTS audio_confidence text;
ALTER TABLE reel_brain.jobs ADD COLUMN IF NOT EXISTS source_dedupe_key_missing boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_message_id_unique_idx
  ON reel_brain.jobs(source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_key_cloud_unique_idx
  ON reel_brain.jobs(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS jobs_shortcode_idx
  ON reel_brain.jobs(shortcode);

CREATE INDEX IF NOT EXISTS jobs_pilot_run_idx
  ON reel_brain.jobs(pilot_run_id, status);

ALTER TABLE reel_brain.resources ADD COLUMN IF NOT EXISTS guide_markdown_key text;
ALTER TABLE reel_brain.resources ADD COLUMN IF NOT EXISTS guide_html_key text;
ALTER TABLE reel_brain.resources ADD COLUMN IF NOT EXISTS evidence_json text;

CREATE INDEX IF NOT EXISTS resources_name_idx
  ON reel_brain.resources(name);

CREATE INDEX IF NOT EXISTS resources_artifact_type_idx
  ON reel_brain.resources(artifact_type);

ALTER TABLE reel_brain.artifacts ADD COLUMN IF NOT EXISTS source_artifact_id text;
ALTER TABLE reel_brain.artifacts ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE reel_brain.artifacts ADD COLUMN IF NOT EXISTS source_sha256 text;
ALTER TABLE reel_brain.artifacts ADD COLUMN IF NOT EXISTS source_byte_size bigint;

CREATE UNIQUE INDEX IF NOT EXISTS artifacts_source_artifact_id_unique_idx
  ON reel_brain.artifacts(source_artifact_id)
  WHERE source_artifact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS artifacts_object_key_unique_idx
  ON reel_brain.artifacts(object_key);

CREATE INDEX IF NOT EXISTS artifacts_job_kind_idx
  ON reel_brain.artifacts(job_id, kind);

CREATE TABLE IF NOT EXISTS reel_brain.notes (
  id text PRIMARY KEY,
  sender_id text,
  body text NOT NULL,
  source_message_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.runtime_secrets (
  name text PRIMARY KEY,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  ciphertext_sha256 text,
  iv_sha256 text,
  redacted boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (redacted IS TRUE)
);

CREATE TABLE IF NOT EXISTS reel_brain.dm_commands (
  id text PRIMARY KEY,
  sender_id text,
  source_message_id text UNIQUE,
  intent text NOT NULL,
  input_text text NOT NULL,
  normalized_query text,
  status text NOT NULL DEFAULT 'received',
  result_job_id text REFERENCES reel_brain.jobs(id) ON DELETE SET NULL,
  result_summary text,
  error text,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS dm_commands_created_idx
  ON reel_brain.dm_commands(created_at DESC);

CREATE INDEX IF NOT EXISTS dm_commands_status_idx
  ON reel_brain.dm_commands(status, created_at DESC);

CREATE TABLE IF NOT EXISTS reel_brain.outbound_events (
  id text PRIMARY KEY,
  recipient_id text,
  source_message_id text,
  job_id text REFERENCES reel_brain.jobs(id) ON DELETE SET NULL,
  kind text NOT NULL,
  stage text,
  display_emoji text,
  reaction text,
  status text NOT NULL,
  http_status integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbound_events_created_idx
  ON reel_brain.outbound_events(created_at DESC);

CREATE INDEX IF NOT EXISTS outbound_events_status_idx
  ON reel_brain.outbound_events(status, created_at DESC);

CREATE TABLE IF NOT EXISTS reel_brain.pilot_runs (
  id text PRIMARY KEY,
  pilot_key text NOT NULL UNIQUE,
  target_count integer NOT NULL,
  status text NOT NULL DEFAULT 'selecting',
  selected_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  unavailable_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.pilot_items (
  id text PRIMARY KEY,
  pilot_run_id text NOT NULL REFERENCES reel_brain.pilot_runs(id) ON DELETE CASCADE,
  source_message_id text NOT NULL,
  source_url text,
  shortcode text,
  job_id text REFERENCES reel_brain.jobs(id) ON DELETE SET NULL,
  decision text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(pilot_run_id, source_message_id)
);

CREATE INDEX IF NOT EXISTS pilot_items_run_decision_idx
  ON reel_brain.pilot_items(pilot_run_id, decision, created_at);

CREATE TABLE IF NOT EXISTS reel_brain.pilot_candidate_cache (
  pilot_key text PRIMARY KEY,
  candidates_json text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pilot_candidate_cache_expiry_idx
  ON reel_brain.pilot_candidate_cache(expires_at);

CREATE TABLE IF NOT EXISTS reel_brain.inbound_webhook_events (
  source_message_id text PRIMARY KEY,
  sender_id text,
  has_share_attachment boolean NOT NULL DEFAULT false,
  extracted_urls_json text NOT NULL DEFAULT '[]',
  raw_json text,
  recovery_json text,
  recovered_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_webhook_events_created_idx
  ON reel_brain.inbound_webhook_events(created_at DESC);

ALTER TABLE reel_brain.instagram_carousel_resolutions ADD COLUMN IF NOT EXISTS media_id text;
ALTER TABLE reel_brain.instagram_carousel_resolutions ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE reel_brain.instagram_carousel_resolutions ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE reel_brain.instagram_carousel_resolutions ADD COLUMN IF NOT EXISTS resolution_method text;
ALTER TABLE reel_brain.instagram_carousel_resolutions ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE reel_brain.instagram_carousel_resolutions ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE reel_brain.instagram_carousel_resolutions
  DROP CONSTRAINT IF EXISTS instagram_carousel_resolutions_status_check;
ALTER TABLE reel_brain.instagram_carousel_resolutions
  ADD CONSTRAINT instagram_carousel_resolutions_status_check
  CHECK (status IN ('queued', 'running', 'complete', 'failed', 'waiting_for_auth'));

CREATE INDEX IF NOT EXISTS instagram_carousel_resolution_status_idx
  ON reel_brain.instagram_carousel_resolutions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS reel_brain.d1_migrations (
  id integer PRIMARY KEY,
  name text UNIQUE,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.phase3_import_metadata (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.phase3_import_checks (
  check_name text PRIMARY KEY,
  expected_value text NOT NULL,
  actual_value text NOT NULL,
  ok boolean NOT NULL,
  detail text
);

INSERT INTO reel_brain.migration_metadata (migration_name, notes)
VALUES ('0003_phase3_cloud_schema_drift', 'Phase 3 typed operational shadow import compatibility; services remain disabled.')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
