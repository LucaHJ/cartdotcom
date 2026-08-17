ALTER TABLE resources ADD COLUMN canonical_key TEXT;
ALTER TABLE resources ADD COLUMN guide_text TEXT;

CREATE INDEX IF NOT EXISTS resources_canonical_key_idx ON resources(canonical_key);

UPDATE resources
SET canonical_key = artifact_type || ':' || slug
WHERE artifact_type IS NOT NULL AND artifact_type != '';
