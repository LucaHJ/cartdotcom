BEGIN;

CREATE TABLE IF NOT EXISTS market_tracking_jobs (
  outcome_id text PRIMARY KEY REFERENCES prediction_outcomes(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'running', 'paused')),
  next_check_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_market_tracking_claim
  ON market_tracking_jobs(status, next_check_at, lease_expires_at);

COMMIT;
