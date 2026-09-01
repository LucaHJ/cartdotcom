ALTER TABLE broker_status
  ADD COLUMN IF NOT EXISTS portfolio_readable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_us_stock_quotes boolean,
  ADD COLUMN IF NOT EXISTS api_us_stock_order_access boolean,
  ADD COLUMN IF NOT EXISTS capability_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_capability_probe_at timestamptz;

