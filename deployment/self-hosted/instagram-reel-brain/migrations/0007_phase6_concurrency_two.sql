BEGIN;

DROP INDEX IF EXISTS reel_brain.phase5_pilot_leases_one_active_idx;

CREATE UNIQUE INDEX IF NOT EXISTS phase6_pilot_leases_active_owner_idx
  ON reel_brain.phase5_pilot_leases(lease_owner)
  WHERE status IN ('leased', 'processing');

INSERT INTO reel_brain.migration_metadata(migration_name, notes)
VALUES ('0007_phase6_concurrency_two', 'Two exact Phase 6 worker slots; local control enforces an advisory-locked global maximum of two. Historical backlog remains disabled.')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
