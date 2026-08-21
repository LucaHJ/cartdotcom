BEGIN;

-- Phase 4 shadow live intake metadata. These tables are local-only and
-- non-authoritative. They record post-watermark pull-mirror cursors, receipts,
-- divergence evidence, and copied-object verification without enabling local
-- processing, dispatch, Codex, publication, or Instagram outbound behaviour.

CREATE TABLE IF NOT EXISTS reel_brain.phase4_mirror_metadata (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.phase4_mirror_cursors (
  table_name text PRIMARY KEY,
  cursor_token text,
  watermark timestamptz NOT NULL,
  last_mirror_updated_at timestamptz,
  last_source_key text,
  rows_seen bigint NOT NULL DEFAULT 0,
  last_poll_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_brain.phase4_mirror_row_versions (
  table_name text NOT NULL,
  source_key text NOT NULL,
  mirror_updated_at timestamptz NOT NULL,
  row_sha256 text NOT NULL,
  row_json jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, source_key, mirror_updated_at, row_sha256)
);

CREATE TABLE IF NOT EXISTS reel_brain.phase4_mirror_typed_hashes (
  table_name text NOT NULL,
  source_key text NOT NULL,
  mirror_updated_at timestamptz NOT NULL,
  row_sha256 text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, source_key)
);

CREATE TABLE IF NOT EXISTS reel_brain.phase4_mirror_object_receipts (
  object_key text PRIMARY KEY,
  local_path text NOT NULL,
  expected_byte_size bigint,
  actual_byte_size bigint NOT NULL CHECK (actual_byte_size >= 0),
  expected_sha256 text,
  actual_sha256 text NOT NULL,
  content_type text,
  downloaded_at timestamptz NOT NULL DEFAULT now(),
  verified boolean NOT NULL,
  detail text
);

CREATE TABLE IF NOT EXISTS reel_brain.phase4_mirror_errors (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  surface text NOT NULL,
  code text NOT NULL,
  detail text NOT NULL,
  retryable boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS reel_brain.phase4_mirror_divergences (
  id bigserial PRIMARY KEY,
  detected_at timestamptz NOT NULL DEFAULT now(),
  surface text NOT NULL,
  table_name text,
  source_key text,
  object_key text,
  expected_json jsonb,
  actual_json jsonb,
  detail text NOT NULL,
  resolved boolean NOT NULL DEFAULT false
);

INSERT INTO reel_brain.migration_metadata (migration_name, notes)
VALUES ('0004_phase4_shadow_live_mirror', 'Phase 4 post-watermark pull-mirror metadata only; local services remain disabled.')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
