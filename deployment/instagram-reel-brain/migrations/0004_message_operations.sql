CREATE TABLE IF NOT EXISTS dm_commands (
  id TEXT PRIMARY KEY,
  sender_id TEXT,
  source_message_id TEXT UNIQUE,
  intent TEXT NOT NULL,
  input_text TEXT NOT NULL,
  normalized_query TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  result_job_id TEXT,
  result_summary TEXT,
  error TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS dm_commands_created_idx ON dm_commands(created_at DESC);
CREATE INDEX IF NOT EXISTS dm_commands_status_idx ON dm_commands(status, created_at DESC);

CREATE TABLE IF NOT EXISTS outbound_events (
  id TEXT PRIMARY KEY,
  recipient_id TEXT,
  source_message_id TEXT,
  job_id TEXT,
  kind TEXT NOT NULL,
  stage TEXT,
  display_emoji TEXT,
  reaction TEXT,
  status TEXT NOT NULL,
  http_status INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS outbound_events_created_idx ON outbound_events(created_at DESC);
CREATE INDEX IF NOT EXISTS outbound_events_status_idx ON outbound_events(status, created_at DESC);
