CREATE TABLE IF NOT EXISTS model_experiments (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'preparing',
  sample_size INTEGER NOT NULL,
  phase INTEGER NOT NULL DEFAULT 1,
  phase_1_model TEXT NOT NULL,
  phase_1_effort TEXT NOT NULL,
  phase_2_model TEXT NOT NULL,
  phase_2_effort TEXT NOT NULL,
  email_to TEXT,
  report_json TEXT,
  report_text TEXT,
  email_status TEXT,
  email_error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_experiment_samples (
  experiment_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  sample_ordinal INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  reference_result_id TEXT,
  reference_calls_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (experiment_id, article_id),
  UNIQUE (experiment_id, sample_ordinal)
);

CREATE TABLE IF NOT EXISTS model_experiment_jobs (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  sample_ordinal INTEGER NOT NULL,
  phase INTEGER NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  research_slot INTEGER,
  queued_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  duration_seconds INTEGER,
  last_error TEXT,
  memo TEXT,
  fields_json TEXT,
  calls_json TEXT NOT NULL DEFAULT '[]',
  input_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (experiment_id, article_id, phase)
);

CREATE INDEX IF NOT EXISTS idx_model_experiment_jobs_dispatch
ON model_experiment_jobs(experiment_id, phase, status, sample_ordinal);

CREATE INDEX IF NOT EXISTS idx_model_experiment_jobs_slot
ON model_experiment_jobs(research_slot, status);

CREATE TABLE IF NOT EXISTS model_experiment_prices (
  experiment_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  baseline_price REAL,
  baseline_at TEXT,
  intervals_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (experiment_id, article_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_model_experiment_prices_status
ON model_experiment_prices(experiment_id, status);
