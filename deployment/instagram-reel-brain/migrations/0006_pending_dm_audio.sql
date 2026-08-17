CREATE TABLE IF NOT EXISTS pending_dm_parts (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  source_url TEXT,
  instructions TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pending_dm_parts_sender_idx
  ON pending_dm_parts(sender_id, consumed_at, expires_at, created_at DESC);

ALTER TABLE jobs ADD COLUMN audio_key TEXT;
ALTER TABLE jobs ADD COLUMN audio_title TEXT;
ALTER TABLE jobs ADD COLUMN audio_artist TEXT;
ALTER TABLE jobs ADD COLUMN audio_source_url TEXT;
ALTER TABLE jobs ADD COLUMN audio_identification_method TEXT;
ALTER TABLE jobs ADD COLUMN audio_confidence TEXT;
