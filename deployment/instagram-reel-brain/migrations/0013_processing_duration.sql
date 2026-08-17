ALTER TABLE jobs ADD COLUMN processing_seconds REAL;

UPDATE jobs
SET processing_seconds = ROUND((julianday(completed_at) - julianday(created_at)) * 86400.0, 1)
WHERE status = 'complete'
  AND completed_at IS NOT NULL
  AND created_at IS NOT NULL
  AND processing_seconds IS NULL;
