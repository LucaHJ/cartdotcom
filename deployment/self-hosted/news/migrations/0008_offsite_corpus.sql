BEGIN;

ALTER TABLE article_corpus_objects
  ADD COLUMN IF NOT EXISTS offsite_status text NOT NULL DEFAULT 'stored';
ALTER TABLE article_corpus_objects
  ADD COLUMN IF NOT EXISTS offsite_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE article_corpus_objects
  ADD COLUMN IF NOT EXISTS offsite_at timestamptz;
ALTER TABLE article_corpus_objects
  ADD COLUMN IF NOT EXISTS offsite_error text;

CREATE INDEX IF NOT EXISTS idx_article_corpus_offsite
  ON article_corpus_objects(offsite_status, offsite_attempts, updated_at);

COMMIT;
