ALTER TABLE sources ADD COLUMN source_type TEXT NOT NULL DEFAULT 'editorial';

ALTER TABLE articles ADD COLUMN content_plaintext TEXT;
ALTER TABLE articles ADD COLUMN content_source TEXT;
ALTER TABLE articles ADD COLUMN content_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE articles ADD COLUMN content_fetched_at TEXT;
ALTER TABLE articles ADD COLUMN content_fetch_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN content_error TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_content_backfill
ON articles(content_status, content_fetch_attempts, discovered_at);
