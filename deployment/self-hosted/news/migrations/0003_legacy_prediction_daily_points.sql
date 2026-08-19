BEGIN;

CREATE TABLE IF NOT EXISTS prediction_daily_points (
  outcome_id text NOT NULL,
  prediction_at timestamptz NOT NULL,
  day_index integer NOT NULL,
  sampled_at timestamptz NOT NULL,
  price double precision NOT NULL,
  change_pct double precision NOT NULL,
  PRIMARY KEY (outcome_id, day_index)
);

CREATE INDEX IF NOT EXISTS idx_prediction_daily_points_day
ON prediction_daily_points(day_index);

COMMIT;
