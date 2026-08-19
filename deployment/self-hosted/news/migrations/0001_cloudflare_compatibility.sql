BEGIN;

CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  name text NOT NULL,
  url text NOT NULL,
  category text NOT NULL,
  weight double precision NOT NULL DEFAULT 1.0,
  enabled integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_type text NOT NULL DEFAULT 'editorial'
);

CREATE TABLE IF NOT EXISTS articles (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES sources(id),
  title text NOT NULL,
  url text NOT NULL UNIQUE,
  summary text,
  published_at timestamptz,
  discovered_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  content_plaintext text,
  content_source text,
  content_status text NOT NULL DEFAULT 'pending',
  content_fetched_at timestamptz,
  content_fetch_attempts integer NOT NULL DEFAULT 0,
  content_error text
);

CREATE TABLE IF NOT EXISTS research_jobs (
  id text PRIMARY KEY,
  article_id text NOT NULL REFERENCES articles(id),
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  queued_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at timestamptz,
  finished_at timestamptz,
  synthesis_duration_seconds integer,
  prediction_delay_seconds integer,
  research_slot integer,
  prediction_delay_eligible integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS research_results (
  id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE REFERENCES research_jobs(id),
  article_id text NOT NULL REFERENCES articles(id),
  event_type text,
  companies text,
  industries text,
  symbols text,
  sentiment_score double precision,
  impact_horizon text,
  confidence double precision,
  summary text,
  memo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS price_impacts (
  article_id text NOT NULL REFERENCES articles(id),
  symbol text NOT NULL,
  baseline_price double precision,
  baseline_at timestamptz,
  intervals_json text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (article_id, symbol)
);

CREATE TABLE IF NOT EXISTS prediction_outcomes (
  id text PRIMARY KEY,
  result_id text NOT NULL,
  article_id text NOT NULL,
  article_title text,
  article_url text,
  symbol text NOT NULL,
  company text,
  direction text NOT NULL CHECK (direction IN ('bullish', 'bearish')),
  score double precision,
  confidence double precision,
  rationale text,
  prediction_at timestamptz NOT NULL,
  baseline_price double precision,
  baseline_at timestamptz,
  intervals_json text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (result_id, symbol)
);

CREATE TABLE IF NOT EXISTS source_checks (
  id text PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  acquired_count integer NOT NULL DEFAULT 0,
  source_count integer NOT NULL DEFAULT 0,
  failed_source_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS article_corpus_objects (
  article_id text PRIMARY KEY REFERENCES articles(id),
  object_key text,
  content_sha256 text,
  content_chars integer NOT NULL DEFAULT 0,
  object_bytes integer NOT NULL DEFAULT 0,
  storage_status text NOT NULL DEFAULT 'pending',
  storage_attempts integer NOT NULL DEFAULT 0,
  schema_version integer NOT NULL DEFAULT 1,
  extraction_version text NOT NULL DEFAULT 'unknown',
  stored_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_articles_discovered_at ON articles(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source_id ON articles(source_id);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_content_backfill ON articles(content_status, content_fetch_attempts, discovered_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_jobs_article_unique ON research_jobs(article_id);
CREATE INDEX IF NOT EXISTS idx_research_jobs_status ON research_jobs(status, queued_at);
CREATE INDEX IF NOT EXISTS idx_research_jobs_article_id ON research_jobs(article_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_research_jobs_running_slot ON research_jobs(research_slot) WHERE status = 'running' AND research_slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_research_jobs_prediction_delay_cohort ON research_jobs(prediction_delay_eligible, status, finished_at);
CREATE INDEX IF NOT EXISTS idx_research_results_article_id ON research_results(article_id);
CREATE INDEX IF NOT EXISTS idx_research_results_created_at ON research_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_impacts_article_id ON price_impacts(article_id);
CREATE INDEX IF NOT EXISTS idx_price_impacts_symbol ON price_impacts(symbol);
CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_prediction_at ON prediction_outcomes(prediction_at DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_symbol ON prediction_outcomes(symbol);
CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_symbol_prediction_at_direction ON prediction_outcomes(symbol, prediction_at, direction);
CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_article_prediction_at ON prediction_outcomes(article_id, prediction_at);
CREATE INDEX IF NOT EXISTS idx_source_checks_checked_at ON source_checks(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_corpus_objects_status ON article_corpus_objects(storage_status, storage_attempts, updated_at);

COMMIT;
