PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS retrieval_documents (
  job_id TEXT PRIMARY KEY,
  document_version INTEGER NOT NULL,
  title_text TEXT NOT NULL DEFAULT '',
  author_text TEXT NOT NULL DEFAULT '',
  description_text TEXT NOT NULL DEFAULT '',
  instructions_text TEXT NOT NULL DEFAULT '',
  summary_text TEXT NOT NULL DEFAULT '',
  visual_text TEXT NOT NULL DEFAULT '',
  transcript_text TEXT NOT NULL DEFAULT '',
  comments_text TEXT NOT NULL DEFAULT '',
  resource_names_text TEXT NOT NULL DEFAULT '',
  resource_details_text TEXT NOT NULL DEFAULT '',
  claims_text TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  source_updated_at TEXT,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS retrieval_terms (
  job_id TEXT NOT NULL,
  term TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(job_id, term),
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS retrieval_terms_term_job_idx ON retrieval_terms(term, job_id);
CREATE INDEX IF NOT EXISTS retrieval_documents_indexed_idx ON retrieval_documents(indexed_at, job_id);
