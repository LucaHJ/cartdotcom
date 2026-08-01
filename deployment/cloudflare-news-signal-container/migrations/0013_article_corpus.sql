CREATE TABLE IF NOT EXISTS article_corpus_objects (
  article_id TEXT PRIMARY KEY REFERENCES articles(id),
  object_key TEXT,
  content_sha256 TEXT,
  content_chars INTEGER NOT NULL DEFAULT 0,
  object_bytes INTEGER NOT NULL DEFAULT 0,
  storage_status TEXT NOT NULL DEFAULT 'pending',
  storage_attempts INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  extraction_version TEXT NOT NULL DEFAULT 'unknown',
  stored_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_article_corpus_objects_status
ON article_corpus_objects(storage_status, storage_attempts, updated_at);
