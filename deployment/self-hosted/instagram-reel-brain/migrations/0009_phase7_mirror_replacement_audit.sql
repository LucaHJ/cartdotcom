BEGIN;

-- A corrective synthesis deletes and recreates D1 resource rows. The source
-- ids therefore change while the stable (job_id, slug) identity remains. Keep
-- the displaced local row as audit evidence before accepting the newer source
-- row, rather than allowing the operational unique constraint to stall intake.
CREATE TABLE IF NOT EXISTS reel_brain.phase7_mirror_row_replacements (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  semantic_key text NOT NULL,
  prior_source_key text NOT NULL,
  replacement_source_key text NOT NULL,
  prior_row_json jsonb NOT NULL,
  replacement_row_json jsonb NOT NULL,
  reason text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(table_name, prior_source_key, replacement_source_key)
);

INSERT INTO reel_brain.migration_metadata(migration_name,notes)
VALUES ('0009_phase7_mirror_replacement_audit','Audit and safely accept newer resource ids that replace the same job/slug after corrective synthesis.')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
