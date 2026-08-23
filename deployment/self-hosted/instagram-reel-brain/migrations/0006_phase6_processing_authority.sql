BEGIN;

ALTER TABLE reel_phase4_shadow_20260821_014246.processing_authority
  ADD COLUMN IF NOT EXISTS generation bigint NOT NULL DEFAULT 0;
ALTER TABLE reel_phase4_shadow_20260821_014246.processing_authority
  ADD COLUMN IF NOT EXISTS cutover_watermark timestamptz;
ALTER TABLE reel_phase4_shadow_20260821_014246.processing_authority
  ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE reel_phase4_shadow_20260821_014246.processing_authority
  ADD COLUMN IF NOT EXISTS audit_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS reel_phase4_shadow_20260821_014246.processing_authority_events (
  id bigserial PRIMARY KEY,
  authority_key text NOT NULL,
  generation bigint NOT NULL,
  from_mode text NOT NULL,
  to_mode text NOT NULL,
  watermark timestamptz,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO reel_phase4_shadow_20260821_014246.migration_metadata (migration_name, notes)
VALUES ('0006_phase6_processing_authority', 'Phase 6 durable authority audit columns and events; backlog remains disabled.')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
