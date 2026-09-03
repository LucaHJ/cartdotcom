CREATE TABLE IF NOT EXISTS portfolio_cache (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  snapshot jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS research_context jsonb;
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS runner_result_path text;
CREATE TABLE IF NOT EXISTS execution_queue (
  run_id uuid PRIMARY KEY REFERENCES research_runs(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','executing','needs_reconciliation','completed','expired','superseded','cancelled')),
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS execution_queue_due ON execution_queue(status,next_attempt_at);
