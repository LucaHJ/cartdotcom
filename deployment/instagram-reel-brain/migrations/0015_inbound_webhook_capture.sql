CREATE TABLE IF NOT EXISTS inbound_webhook_events (
  source_message_id TEXT PRIMARY KEY,
  sender_id TEXT,
  has_share_attachment INTEGER NOT NULL DEFAULT 0,
  extracted_urls_json TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT,
  recovery_json TEXT,
  recovered_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS inbound_webhook_events_created_idx
  ON inbound_webhook_events(created_at DESC);
