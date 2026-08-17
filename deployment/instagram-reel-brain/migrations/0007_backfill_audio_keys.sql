UPDATE jobs
SET audio_key = (
  SELECT artifacts.object_key
  FROM artifacts
  WHERE artifacts.job_id = jobs.id AND artifacts.kind = 'audio'
  ORDER BY artifacts.created_at DESC
  LIMIT 1
), updated_at = CURRENT_TIMESTAMP
WHERE audio_key IS NULL
  AND EXISTS (
    SELECT 1 FROM artifacts
    WHERE artifacts.job_id = jobs.id AND artifacts.kind = 'audio'
  );
