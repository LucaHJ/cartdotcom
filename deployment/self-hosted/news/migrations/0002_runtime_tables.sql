BEGIN;

ALTER TABLE source_checks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE source_checks ADD COLUMN IF NOT EXISTS duration_seconds integer;

CREATE TABLE IF NOT EXISTS source_hourly_metrics (
  hour_start timestamptz PRIMARY KEY,
  article_count integer NOT NULL DEFAULT 0,
  ticker_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_metric_state (
  key text PRIMARY KEY,
  completed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feed_ingestion_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_source_state (
  source_id text PRIMARY KEY,
  initialized_at timestamptz NOT NULL,
  last_checked_at timestamptz NOT NULL,
  last_success_at timestamptz,
  last_item_count integer NOT NULL DEFAULT 0,
  last_feed_hash text,
  last_error text
);

CREATE TABLE IF NOT EXISTS feed_item_ledger (
  id text PRIMARY KEY,
  source_id text NOT NULL,
  url text NOT NULL,
  article_id text,
  title text NOT NULL,
  summary text,
  content_plaintext text,
  published_at timestamptz,
  first_seen_at timestamptz NOT NULL,
  first_check_id text NOT NULL,
  disposition text NOT NULL,
  acquired_at timestamptz,
  last_error text,
  UNIQUE (source_id, url)
);

CREATE TABLE IF NOT EXISTS source_check_details (
  check_id text NOT NULL,
  source_id text NOT NULL,
  fetched_item_count integer NOT NULL DEFAULT 0,
  new_item_count integer NOT NULL DEFAULT 0,
  acquired_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  baseline_count integer NOT NULL DEFAULT 0,
  stale_count integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  error text,
  PRIMARY KEY (check_id, source_id)
);

CREATE TABLE IF NOT EXISTS prediction_outcome_scans (
  result_id text PRIMARY KEY,
  scanned_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  outcome_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prediction_daily_points_v2 (
  outcome_id text NOT NULL,
  prediction_at timestamptz NOT NULL,
  day_index integer NOT NULL,
  sampled_at timestamptz NOT NULL,
  price double precision NOT NULL,
  change_pct double precision NOT NULL,
  PRIMARY KEY (outcome_id, day_index)
);

CREATE TABLE IF NOT EXISTS runtime_secrets (
  name text PRIMARY KEY,
  ciphertext text NOT NULL,
  iv text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_experiments (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'preparing',
  sample_size integer NOT NULL,
  phase integer NOT NULL DEFAULT 1,
  phase_1_model text NOT NULL,
  phase_1_effort text NOT NULL,
  phase_2_model text NOT NULL,
  phase_2_effort text NOT NULL,
  email_to text,
  report_json text,
  report_text text,
  email_status text,
  email_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_experiment_samples (
  experiment_id text NOT NULL,
  article_id text NOT NULL,
  sample_ordinal integer NOT NULL,
  input_hash text NOT NULL,
  reference_result_id text,
  reference_calls_json text NOT NULL DEFAULT '[]',
  PRIMARY KEY (experiment_id, article_id),
  UNIQUE (experiment_id, sample_ordinal)
);

CREATE TABLE IF NOT EXISTS model_experiment_jobs (
  id text PRIMARY KEY,
  experiment_id text NOT NULL,
  article_id text NOT NULL,
  sample_ordinal integer NOT NULL,
  phase integer NOT NULL,
  model text NOT NULL,
  reasoning_effort text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  research_slot integer,
  queued_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  duration_seconds integer,
  last_error text,
  memo text,
  fields_json text,
  calls_json text NOT NULL DEFAULT '[]',
  input_hash text,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (experiment_id, article_id, phase)
);

CREATE TABLE IF NOT EXISTS model_experiment_prices (
  experiment_id text NOT NULL,
  article_id text NOT NULL,
  symbol text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  baseline_price double precision,
  baseline_at timestamptz,
  intervals_json text NOT NULL DEFAULT '{}',
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (experiment_id, article_id, symbol)
);

CREATE TABLE IF NOT EXISTS simulation_state (
  id text PRIMARY KEY,
  starting_cash double precision NOT NULL,
  cash double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS simulation_positions (
  symbol text PRIMARY KEY,
  shares double precision NOT NULL,
  average_price double precision NOT NULL,
  last_action_at timestamptz,
  last_buy_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS simulation_processed_results (
  result_id text PRIMARY KEY,
  article_id text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  skipped_reason text
);

CREATE TABLE IF NOT EXISTS simulation_trades (
  id text PRIMARY KEY,
  result_id text NOT NULL,
  article_id text NOT NULL,
  action text NOT NULL,
  symbol text NOT NULL,
  article_title text NOT NULL,
  article_url text NOT NULL,
  event_type text,
  sentiment_score double precision NOT NULL,
  confidence double precision NOT NULL,
  price double precision NOT NULL,
  shares double precision NOT NULL,
  notional double precision NOT NULL,
  cash_after double precision NOT NULL,
  portfolio_value double precision NOT NULL,
  action_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS simulation_snapshots (
  id text PRIMARY KEY,
  at timestamptz NOT NULL,
  cash double precision NOT NULL,
  investment_value double precision NOT NULL,
  total_value double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eod_simulation_state (
  id text PRIMARY KEY,
  starting_cash double precision NOT NULL,
  cash double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eod_simulation_positions (
  symbol text PRIMARY KEY,
  shares double precision NOT NULL,
  average_price double precision NOT NULL,
  last_action_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eod_reports (
  id text PRIMARY KEY,
  report_date date NOT NULL UNIQUE,
  summary text NOT NULL,
  candidates_json text NOT NULL,
  chosen_json text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eod_simulation_trades (
  id text PRIMARY KEY,
  report_id text NOT NULL,
  action text NOT NULL,
  symbol text NOT NULL,
  thesis text NOT NULL,
  event_count integer NOT NULL,
  score double precision NOT NULL,
  confidence double precision NOT NULL,
  price double precision NOT NULL,
  shares double precision NOT NULL,
  notional double precision NOT NULL,
  cash_after double precision NOT NULL,
  portfolio_value double precision NOT NULL,
  action_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eod_simulation_snapshots (
  id text PRIMARY KEY,
  at timestamptz NOT NULL,
  cash double precision NOT NULL,
  investment_value double precision NOT NULL,
  total_value double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_hourly_metrics_hour ON source_hourly_metrics(hour_start);
CREATE INDEX IF NOT EXISTS idx_feed_item_ledger_disposition ON feed_item_ledger(disposition, first_seen_at);
CREATE INDEX IF NOT EXISTS idx_feed_item_ledger_source ON feed_item_ledger(source_id, first_seen_at);
CREATE INDEX IF NOT EXISTS idx_source_check_details_source ON source_check_details(source_id, check_id);
CREATE INDEX IF NOT EXISTS idx_prediction_outcome_scans_scanned_at ON prediction_outcome_scans(scanned_at);
CREATE INDEX IF NOT EXISTS idx_prediction_daily_points_v2_day ON prediction_daily_points_v2(day_index);
CREATE INDEX IF NOT EXISTS idx_model_experiment_jobs_dispatch ON model_experiment_jobs(experiment_id, phase, status, sample_ordinal);
CREATE INDEX IF NOT EXISTS idx_model_experiment_jobs_slot ON model_experiment_jobs(research_slot, status);
CREATE INDEX IF NOT EXISTS idx_model_experiment_prices_status ON model_experiment_prices(experiment_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_simulation_trades_result_symbol_action ON simulation_trades(result_id, symbol, action);
CREATE INDEX IF NOT EXISTS idx_simulation_trades_action_at ON simulation_trades(action_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulation_snapshots_at ON simulation_snapshots(at DESC);
CREATE INDEX IF NOT EXISTS idx_eod_reports_date ON eod_reports(report_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_eod_trades_report_symbol_action ON eod_simulation_trades(report_id, symbol, action);
CREATE INDEX IF NOT EXISTS idx_eod_trades_action_at ON eod_simulation_trades(action_at DESC);
CREATE INDEX IF NOT EXISTS idx_eod_snapshots_at ON eod_simulation_snapshots(at DESC);

COMMIT;
