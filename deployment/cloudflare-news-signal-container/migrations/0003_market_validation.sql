CREATE TABLE IF NOT EXISTS price_impacts (
  article_id TEXT NOT NULL REFERENCES articles(id),
  symbol TEXT NOT NULL,
  baseline_price REAL,
  baseline_at TEXT,
  intervals_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (article_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_price_impacts_article_id ON price_impacts(article_id);
CREATE INDEX IF NOT EXISTS idx_price_impacts_symbol ON price_impacts(symbol);
