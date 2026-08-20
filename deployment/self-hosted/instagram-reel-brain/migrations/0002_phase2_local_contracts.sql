BEGIN;

CREATE TABLE IF NOT EXISTS reel_brain.jobs (
  id text PRIMARY KEY,
  source_url text NOT NULL,
  canonical_url text,
  shortcode text,
  dedupe_key text NOT NULL,
  pilot_run_id text,
  sender_id text,
  source_message_id text,
  source_media_json jsonb,
  instructions text,
  title text,
  author_username text,
  description text,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed', 'duplicate')),
  stage text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  status_emoji text NOT NULL DEFAULT '⬇️',
  error_code text,
  error_message text,
  worker_id text,
  original_video_key text,
  audio_key text,
  html_key text,
  library_path text,
  markdown_key text,
  transcript_key text,
  synthesis_json_key text,
  codex_input_tokens integer,
  codex_cached_input_tokens integer,
  codex_output_tokens integer,
  codex_reasoning_output_tokens integer,
  codex_total_tokens integer,
  processing_seconds numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_active_idx
  ON reel_brain.jobs(dedupe_key)
  WHERE status <> 'duplicate';

CREATE INDEX IF NOT EXISTS jobs_status_created_idx
  ON reel_brain.jobs(status, created_at);

CREATE TABLE IF NOT EXISTS reel_brain.job_events (
  id bigserial PRIMARY KEY,
  job_id text NOT NULL REFERENCES reel_brain.jobs(id) ON DELETE CASCADE,
  stage text NOT NULL,
  status text NOT NULL,
  emoji text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.resources (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES reel_brain.jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  kind text,
  canonical_url text,
  summary text,
  why_useful text,
  guide_text text,
  artifact_type text,
  canonical_key text,
  media_json jsonb,
  library_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, slug)
);

CREATE INDEX IF NOT EXISTS resources_canonical_key_idx
  ON reel_brain.resources(canonical_key)
  WHERE canonical_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS reel_brain.artifacts (
  id bigserial PRIMARY KEY,
  job_id text NOT NULL REFERENCES reel_brain.jobs(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  checksum_sha256 text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, object_key)
);

CREATE TABLE IF NOT EXISTS reel_brain.pending_dm_parts (
  id text PRIMARY KEY,
  sender_id text NOT NULL,
  source_message_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('share', 'instruction', 'unsupported_share')),
  source_url text,
  instructions text,
  is_test boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pending_dm_parts_claim_idx
  ON reel_brain.pending_dm_parts(sender_id, kind, expires_at DESC)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS reel_brain.instagram_carousel_resolutions (
  id text PRIMARY KEY,
  source_message_id text NOT NULL UNIQUE,
  sender_id text,
  source_media_id text,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  canonical_url text,
  resolved_media_json jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO reel_brain.migration_metadata (migration_name, notes)
VALUES ('0002_phase2_local_contracts', 'Phase 2 local PostgreSQL contracts only; no production import.')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
