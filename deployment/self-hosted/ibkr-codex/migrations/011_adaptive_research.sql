ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS allocation_plan jsonb;
ALTER TABLE decisions DROP CONSTRAINT IF EXISTS decisions_allocation_bucket_check;
DO $$ BEGIN
  ALTER TABLE decisions ADD CONSTRAINT decisions_allocation_bucket_check
    CHECK (allocation_bucket ~ '^[A-Z][A-Z0-9_]{1,63}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
