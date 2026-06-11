CREATE TABLE IF NOT EXISTS simulation_state (
  id TEXT PRIMARY KEY,
  starting_cash REAL NOT NULL,
  cash REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS simulation_positions (
  symbol TEXT PRIMARY KEY,
  shares REAL NOT NULL,
  average_price REAL NOT NULL,
  last_action_at TEXT,
  last_buy_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS simulation_processed_results (
  result_id TEXT PRIMARY KEY REFERENCES research_results(id),
  article_id TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  skipped_reason TEXT
);

CREATE TABLE IF NOT EXISTS simulation_trades (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL REFERENCES research_results(id),
  article_id TEXT NOT NULL,
  action TEXT NOT NULL,
  symbol TEXT NOT NULL,
  article_title TEXT NOT NULL,
  article_url TEXT NOT NULL,
  event_type TEXT,
  sentiment_score REAL NOT NULL,
  confidence REAL NOT NULL,
  price REAL NOT NULL,
  shares REAL NOT NULL,
  notional REAL NOT NULL,
  cash_after REAL NOT NULL,
  portfolio_value REAL NOT NULL,
  action_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_simulation_trades_result_symbol_action ON simulation_trades(result_id, symbol, action);
CREATE INDEX IF NOT EXISTS idx_simulation_trades_action_at ON simulation_trades(action_at DESC);

CREATE TABLE IF NOT EXISTS simulation_snapshots (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  cash REAL NOT NULL,
  investment_value REAL NOT NULL,
  total_value REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_simulation_snapshots_at ON simulation_snapshots(at DESC);
