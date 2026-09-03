ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS allocation_bucket text NOT NULL DEFAULT 'DOMESTIC_DIVERSIFIED';

DO $$ BEGIN
  ALTER TABLE decisions ADD CONSTRAINT decisions_allocation_bucket_check CHECK (
    allocation_bucket IN ('DOMESTIC_DIVERSIFIED','INTERNATIONAL_EQUITY','POWER_AND_GRID'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE portfolio_snapshots
  ADD COLUMN IF NOT EXISTS execution_context jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS fx_rate_cache (
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  rate numeric NOT NULL,
  observation_date date NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  response_sha256 text NOT NULL,
  PRIMARY KEY(base_currency,quote_currency)
);

