ALTER TABLE broker_status
  ADD COLUMN IF NOT EXISTS crypto_usd_order_access boolean;

ALTER TABLE decisions
  ADD COLUMN IF NOT EXISTS asset_type text NOT NULL DEFAULT 'US_EQUITY'
  CHECK (asset_type IN ('US_EQUITY', 'CRYPTO'));
