CREATE TABLE IF NOT EXISTS pilot_candidate_cache (
  pilot_key TEXT PRIMARY KEY,
  candidates_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pilot_candidate_cache_expiry_idx
  ON pilot_candidate_cache(expires_at);
