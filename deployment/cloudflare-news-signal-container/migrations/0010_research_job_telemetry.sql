ALTER TABLE research_jobs ADD COLUMN synthesis_duration_seconds INTEGER;
ALTER TABLE research_jobs ADD COLUMN prediction_delay_seconds INTEGER;
ALTER TABLE research_jobs ADD COLUMN research_slot INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_research_jobs_running_slot
ON research_jobs(research_slot)
WHERE status = 'running' AND research_slot IS NOT NULL;

UPDATE research_jobs
SET synthesis_duration_seconds = MAX(0, unixepoch(finished_at) - unixepoch(started_at))
WHERE synthesis_duration_seconds IS NULL
  AND started_at IS NOT NULL
  AND finished_at IS NOT NULL
  AND status IN ('succeeded', 'failed');

UPDATE research_jobs
SET prediction_delay_seconds = (
  SELECT MAX(0, unixepoch(research_results.created_at) - unixepoch(articles.published_at))
  FROM research_results
  INNER JOIN articles ON articles.id = research_results.article_id
  WHERE research_results.job_id = research_jobs.id
    AND articles.published_at IS NOT NULL
    AND research_results.symbols IS NOT NULL
    AND trim(research_results.symbols) NOT IN ('', '[]')
)
WHERE prediction_delay_seconds IS NULL
  AND status = 'succeeded';
