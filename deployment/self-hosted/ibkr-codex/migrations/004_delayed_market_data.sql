ALTER TABLE broker_status
  ADD COLUMN IF NOT EXISTS delayed_us_stock_quotes boolean;
