ALTER TABLE research_jobs ADD COLUMN prediction_delay_eligible INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_research_jobs_prediction_delay_cohort
ON research_jobs(prediction_delay_eligible, status, finished_at);

UPDATE research_jobs
SET status = 'cancelled',
    last_error = 'Cancelled pre-cohort first-pass backlog',
    finished_at = CURRENT_TIMESTAMP,
    research_slot = NULL
WHERE status = 'pending'
  AND prediction_delay_eligible = 0
  AND NOT EXISTS (
    SELECT 1 FROM research_results WHERE research_results.job_id = research_jobs.id
  );

UPDATE articles
SET status = 'archived'
WHERE EXISTS (
  SELECT 1
  FROM research_jobs
  WHERE research_jobs.article_id = articles.id
    AND research_jobs.status = 'cancelled'
    AND research_jobs.last_error = 'Cancelled pre-cohort first-pass backlog'
);
