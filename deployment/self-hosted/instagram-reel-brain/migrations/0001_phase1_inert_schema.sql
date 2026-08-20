BEGIN;

CREATE SCHEMA IF NOT EXISTS reel_brain;

CREATE TABLE IF NOT EXISTS reel_brain.migration_metadata (
  id bigserial PRIMARY KEY,
  migration_name text NOT NULL UNIQUE,
  applied_at timestamptz NOT NULL DEFAULT now(),
  notes text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reel_brain.processing_authority (
  authority_key text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('cloud', 'self_hosted', 'transition')),
  dispatch_enabled boolean NOT NULL DEFAULT false,
  codex_enabled boolean NOT NULL DEFAULT false,
  outbound_enabled boolean NOT NULL DEFAULT false,
  backlog_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (mode = 'self_hosted' AND dispatch_enabled IS TRUE)
    OR (mode IN ('cloud', 'transition') AND dispatch_enabled IS FALSE)
  )
);

INSERT INTO reel_brain.processing_authority (
  authority_key,
  mode,
  dispatch_enabled,
  codex_enabled,
  outbound_enabled,
  backlog_enabled
) VALUES (
  'instagram-reel-brain',
  'cloud',
  false,
  false,
  false,
  false
) ON CONFLICT (authority_key) DO NOTHING;

INSERT INTO reel_brain.migration_metadata (migration_name, notes)
VALUES ('0001_phase1_inert_schema', 'Phase 1 scaffold only; no production data import.')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
