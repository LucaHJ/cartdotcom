CREATE TABLE IF NOT EXISTS processing_authority (
  authority_key TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('cloud','transition','self_hosted')),
  generation INTEGER NOT NULL DEFAULT 0,
  dispatch_enabled INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_enabled IN (0,1)),
  codex_enabled INTEGER NOT NULL DEFAULT 0 CHECK (codex_enabled IN (0,1)),
  outbound_enabled INTEGER NOT NULL DEFAULT 0 CHECK (outbound_enabled IN (0,1)),
  backlog_enabled INTEGER NOT NULL DEFAULT 0 CHECK (backlog_enabled IN (0,1)),
  cutover_watermark TEXT,
  lease_owner TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  audit_json TEXT NOT NULL DEFAULT '{}',
  CHECK (backlog_enabled = 0),
  CHECK (
    (mode='self_hosted' AND dispatch_enabled=1 AND codex_enabled=1 AND outbound_enabled=1)
    OR (mode IN ('cloud','transition') AND dispatch_enabled=0 AND codex_enabled=0 AND outbound_enabled=0)
  )
);

INSERT OR IGNORE INTO processing_authority(
  authority_key,mode,generation,dispatch_enabled,codex_enabled,outbound_enabled,backlog_enabled,audit_json
) VALUES (
  'instagram-reel-brain','cloud',0,0,0,0,0,'{"created_by":"0024_phase6_processing_authority"}'
);

CREATE TABLE IF NOT EXISTS processing_authority_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  authority_key TEXT NOT NULL,
  generation INTEGER NOT NULL,
  from_mode TEXT NOT NULL,
  to_mode TEXT NOT NULL,
  watermark TEXT,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS processing_authority_events_generation_idx
  ON processing_authority_events(authority_key,generation,created_at);

