CREATE TABLE IF NOT EXISTS prediction_outcomes (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  article_title TEXT,
  article_url TEXT,
  symbol TEXT NOT NULL,
  company TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('bullish', 'bearish')),
  score REAL,
  confidence REAL,
  rationale TEXT,
  prediction_at TEXT NOT NULL,
  baseline_price REAL,
  baseline_at TEXT,
  intervals_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(result_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_prediction_at ON prediction_outcomes(prediction_at DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_symbol ON prediction_outcomes(symbol);
