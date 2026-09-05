CREATE TABLE IF NOT EXISTS market_price_cache (
  symbol text PRIMARY KEY,
  price numeric NOT NULL,
  previous_close numeric,
  observed_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  response_sha256 text NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_performance (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  snapshot jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
