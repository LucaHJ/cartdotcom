CREATE TABLE IF NOT EXISTS portfolio_performance_history (
  observed_hour timestamptz PRIMARY KEY,
  captured_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  payload_bytes integer NOT NULL CHECK (payload_bytes > 0 AND payload_bytes <= 174761)
);

CREATE INDEX IF NOT EXISTS portfolio_performance_history_captured_at
  ON portfolio_performance_history (captured_at DESC);
