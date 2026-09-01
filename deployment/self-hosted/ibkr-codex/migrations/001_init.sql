CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES
  ('kill_switch', 'true'::jsonb),
  ('trading_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS broker_status (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  state text NOT NULL DEFAULT 'needs_auth',
  account_id text,
  message text,
  last_connected_at timestamptz,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  validation_required_since timestamptz,
  last_reminder_at timestamptz
);
INSERT INTO broker_status (singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS research_runs (
  id uuid PRIMARY KEY,
  scheduled_for timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('queued','snapshotting','researching','validating','executing','reconciling','completed','failed','cancelled')),
  trigger text NOT NULL,
  model text NOT NULL,
  reasoning_effort text NOT NULL,
  prompt_path text,
  output_path text,
  event_path text,
  prompt_sha256 text,
  output_sha256 text,
  input_tokens bigint,
  output_tokens bigint,
  cached_input_tokens bigint,
  runtime_seconds numeric,
  portfolio_snapshot_id uuid,
  decision_summary text,
  error text,
  artifact_bytes bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_scheduled_run_per_day
  ON research_runs (((scheduled_for AT TIME ZONE 'America/New_York')::date))
  WHERE trigger = 'schedule';

CREATE TABLE IF NOT EXISTS run_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id uuid PRIMARY KEY,
  run_id uuid REFERENCES research_runs(id) ON DELETE SET NULL,
  account_id text NOT NULL,
  currency text NOT NULL,
  net_liquidation numeric NOT NULL,
  total_cash numeric NOT NULL,
  available_funds numeric NOT NULL,
  buying_power numeric NOT NULL,
  excess_liquidity numeric NOT NULL,
  positions jsonb NOT NULL,
  open_orders jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE research_runs
  DROP CONSTRAINT IF EXISTS research_runs_portfolio_snapshot_id_fkey;
ALTER TABLE research_runs
  ADD CONSTRAINT research_runs_portfolio_snapshot_id_fkey
  FOREIGN KEY (portfolio_snapshot_id) REFERENCES portfolio_snapshots(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS decisions (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  action text NOT NULL CHECK (action IN ('BUY','SELL','HOLD')),
  target_weight_pct numeric NOT NULL,
  confidence numeric NOT NULL,
  thesis text NOT NULL,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_status text NOT NULL DEFAULT 'pending',
  validation_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES decisions(id) ON DELETE RESTRICT,
  broker_order_id bigint,
  broker_perm_id bigint,
  order_ref text NOT NULL UNIQUE,
  symbol text NOT NULL,
  side text NOT NULL CHECK (side IN ('BUY','SELL')),
  requested_quantity numeric NOT NULL,
  filled_quantity numeric NOT NULL DEFAULT 0,
  remaining_quantity numeric NOT NULL,
  limit_price numeric NOT NULL,
  average_fill_price numeric,
  attempt integer NOT NULL DEFAULT 1,
  status text NOT NULL,
  terminal boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS executions (
  exec_id text PRIMARY KEY,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  account_id text NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL,
  shares numeric NOT NULL,
  price numeric NOT NULL,
  commission numeric,
  executed_at timestamptz NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS validation_links (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  destination text NOT NULL,
  status text NOT NULL,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_events_run_created ON run_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS decisions_run ON decisions(run_id);
CREATE INDEX IF NOT EXISTS orders_run ON orders(run_id);
CREATE INDEX IF NOT EXISTS portfolio_captured ON portfolio_snapshots(captured_at DESC);

