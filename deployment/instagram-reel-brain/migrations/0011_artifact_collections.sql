ALTER TABLE resources ADD COLUMN artifact_type TEXT;

CREATE INDEX IF NOT EXISTS resources_artifact_type_idx ON resources(artifact_type);
