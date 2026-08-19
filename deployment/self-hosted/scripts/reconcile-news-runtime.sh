#!/usr/bin/env bash
set -euo pipefail

authority="$(cd /srv/platform && docker compose exec -T postgres \
  psql -U cartdotcom -d cartdotcom -Atc "SELECT owner FROM runtime_authority WHERE scope = 'news-processing'")"
if [[ "${authority}" != "cloudflare" ]]; then
  echo "Runtime reconciliation requires Cloudflare processing authority; current owner is ${authority:-unknown}." >&2
  exit 1
fi

cd /srv/platform
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U cartdotcom -d cartdotcom <<'SQL'
BEGIN;

UPDATE research_jobs
SET status = 'pending', started_at = NULL, finished_at = NULL,
    research_slot = NULL, last_error = 'Recovered Cloudflare in-flight job during final migration sync'
WHERE status = 'running';

UPDATE local_job_queue
SET status = 'pending', available_at = CURRENT_TIMESTAMP,
    lease_owner = NULL, lease_expires_at = NULL,
    last_error = COALESCE(last_error, 'Recovered local lease during final migration sync'),
    finished_at = NULL, updated_at = CURRENT_TIMESTAMP
WHERE status = 'running';

UPDATE local_job_queue AS queue
SET status = CASE
      WHEN jobs.status = 'succeeded' THEN 'succeeded'
      WHEN jobs.status = 'failed' OR articles.status = 'archived' THEN 'failed'
      ELSE 'pending'
    END,
    available_at = CASE WHEN jobs.status = 'pending' AND articles.status != 'archived'
      THEN CURRENT_TIMESTAMP ELSE queue.available_at END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    finished_at = CASE WHEN jobs.status IN ('succeeded', 'failed') OR articles.status = 'archived'
      THEN COALESCE(jobs.finished_at, CURRENT_TIMESTAMP) ELSE NULL END,
    updated_at = CURRENT_TIMESTAMP
FROM research_jobs AS jobs
INNER JOIN articles ON articles.id = jobs.article_id
WHERE queue.research_job_id = jobs.id;

INSERT INTO local_job_queue
  (id, research_job_id, kind, priority, status, payload_json)
SELECT concat('production:', jobs.id), jobs.id, 'production', 100, 'pending',
  jsonb_build_object('jobId', jobs.id, 'articleId', jobs.article_id)
FROM research_jobs AS jobs
INNER JOIN articles ON articles.id = jobs.article_id
LEFT JOIN local_job_queue AS queue ON queue.research_job_id = jobs.id
WHERE jobs.status = 'pending' AND articles.status != 'archived'
  AND queue.research_job_id IS NULL
ON CONFLICT (research_job_id) DO NOTHING;

UPDATE local_job_queue
SET status = 'pending', attempts = 0, available_at = CURRENT_TIMESTAMP,
    lease_owner = NULL, lease_expires_at = NULL, finished_at = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE research_job_id IN (
  SELECT jobs.id FROM research_jobs AS jobs
  INNER JOIN articles ON articles.id = jobs.article_id
  WHERE jobs.status = 'pending' AND articles.status != 'archived'
)
;

COMMIT;

SELECT json_build_object(
  'pending_research_jobs', (SELECT count(*) FROM research_jobs WHERE status = 'pending'),
  'pending_local_jobs', (SELECT count(*) FROM local_job_queue WHERE status = 'pending'),
  'running_local_jobs', (SELECT count(*) FROM local_job_queue WHERE status = 'running'),
  'tracked_predictions', (SELECT count(*) FROM market_tracking_jobs)
);
SQL
