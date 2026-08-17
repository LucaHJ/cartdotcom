CREATE TABLE IF NOT EXISTS instagram_carousel_resolutions (
  source_message_id TEXT PRIMARY KEY,
  sender_id TEXT,
  media_id TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  source_url TEXT,
  resolution_method TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS instagram_carousel_resolution_status_idx
  ON instagram_carousel_resolutions(status, created_at DESC);
