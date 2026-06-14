CREATE TABLE IF NOT EXISTS eod_simulation_state (
  id TEXT PRIMARY KEY,
  starting_cash REAL NOT NULL,
  cash REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eod_simulation_positions (
  symbol TEXT PRIMARY KEY,
  shares REAL NOT NULL,
  average_price REAL NOT NULL,
  last_action_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eod_reports (
  id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  chosen_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eod_reports_date ON eod_reports(report_date DESC);

CREATE TABLE IF NOT EXISTS eod_simulation_trades (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES eod_reports(id),
  action TEXT NOT NULL,
  symbol TEXT NOT NULL,
  thesis TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  score REAL NOT NULL,
  confidence REAL NOT NULL,
  price REAL NOT NULL,
  shares REAL NOT NULL,
  notional REAL NOT NULL,
  cash_after REAL NOT NULL,
  portfolio_value REAL NOT NULL,
  action_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_eod_trades_report_symbol_action ON eod_simulation_trades(report_id, symbol, action);
CREATE INDEX IF NOT EXISTS idx_eod_trades_action_at ON eod_simulation_trades(action_at DESC);

CREATE TABLE IF NOT EXISTS eod_simulation_snapshots (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  cash REAL NOT NULL,
  investment_value REAL NOT NULL,
  total_value REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_eod_snapshots_at ON eod_simulation_snapshots(at DESC);
