PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  canonical_url TEXT,
  shortcode TEXT,
  sender_id TEXT,
  source_message_id TEXT UNIQUE,
  instructions TEXT,
  title TEXT,
  author_username TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  status_emoji TEXT NOT NULL DEFAULT '⬇️',
  error_code TEXT,
  error_message TEXT,
  upload_token_hash TEXT,
  upload_token_expires_at TEXT,
  original_video_key TEXT,
  markdown_key TEXT,
  transcript_key TEXT,
  synthesis_json_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs(status, created_at);
CREATE INDEX IF NOT EXISTS jobs_shortcode_idx ON jobs(shortcode);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT,
  byte_size INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS artifacts_job_kind_idx ON artifacts(job_id, kind);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT,
  canonical_url TEXT,
  summary TEXT,
  why_useful TEXT,
  guide_markdown_key TEXT,
  evidence_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE(job_id, slug)
);

CREATE INDEX IF NOT EXISTS resources_name_idx ON resources(name);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  sender_id TEXT,
  body TEXT NOT NULL,
  source_message_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  emoji TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings(key, value) VALUES
  ('emoji.queued', '{"display":"⬇️","reaction":"like"}'),
  ('emoji.downloading', '{"display":"📥","reaction":"like"}'),
  ('emoji.synthesizing', '{"display":"☁️","reaction":"wow"}'),
  ('emoji.complete', '{"display":"✅","reaction":"love"}'),
  ('emoji.error_download', '{"display":"⛔","reaction":"angry"}'),
  ('emoji.error_media', '{"display":"🎬❌","reaction":"sad"}'),
  ('emoji.error_transcript', '{"display":"🎙️❌","reaction":"sad"}'),
  ('emoji.error_research', '{"display":"🔎❌","reaction":"sad"}'),
  ('emoji.error_archive', '{"display":"🗄️❌","reaction":"angry"}'),
  ('emoji.error_unknown', '{"display":"❓","reaction":"wow"}');
