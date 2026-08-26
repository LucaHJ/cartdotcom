CREATE INDEX IF NOT EXISTS retrieval_terms_mirror_cursor_idx
ON retrieval_terms(indexed_at, job_id, term);
