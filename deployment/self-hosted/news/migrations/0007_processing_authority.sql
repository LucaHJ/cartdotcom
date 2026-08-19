BEGIN;

CREATE TABLE IF NOT EXISTS runtime_authority (
  scope text PRIMARY KEY,
  owner text NOT NULL CHECK (owner IN ('cloudflare', 'self_hosted')),
  epoch bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note text
);

INSERT INTO runtime_authority (scope, owner, epoch, note)
VALUES ('news-processing', 'cloudflare', 0, 'Safe default created by migration.')
ON CONFLICT (scope) DO NOTHING;

CREATE TABLE IF NOT EXISTS runtime_commands (
  id text PRIMARY KEY,
  command text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  requested_by text NOT NULL DEFAULT 'dashboard',
  started_at timestamptz,
  completed_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text
);

CREATE INDEX IF NOT EXISTS idx_runtime_commands_claim
  ON runtime_commands(command, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_runtime_commands_lease
  ON runtime_commands(status, lease_expires_at);

COMMIT;
