ALTER TABLE portfolio_snapshots
  ADD COLUMN IF NOT EXISTS accrued_cash numeric NOT NULL DEFAULT 0;
