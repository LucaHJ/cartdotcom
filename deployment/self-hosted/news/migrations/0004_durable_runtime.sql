BEGIN;

CREATE TABLE IF NOT EXISTS service_heartbeats (
  service_name text PRIMARY KEY,
  instance_id text NOT NULL,
  started_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  status text NOT NULL,
  detail_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS scheduler_runs (
  id text PRIMARY KEY,
  task_name text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  lease_owner text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (task_name, scheduled_for)
);

CREATE TABLE IF NOT EXISTS local_job_queue (
  id text PRIMARY KEY,
  research_job_id text NOT NULL UNIQUE REFERENCES research_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'production',
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  available_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner text,
  lease_expires_at timestamptz,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_scheduler_runs_recovery
  ON scheduler_runs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_scheduler_runs_history
  ON scheduler_runs(task_name, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_local_job_queue_claim
  ON local_job_queue(status, priority DESC, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_local_job_queue_lease
  ON local_job_queue(status, lease_expires_at);

COMMIT;
