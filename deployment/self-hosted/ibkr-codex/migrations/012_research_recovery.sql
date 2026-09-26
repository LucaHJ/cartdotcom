ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS recovery_from_run_id uuid REFERENCES research_runs(id);
CREATE INDEX IF NOT EXISTS research_runs_recovery_source ON research_runs(recovery_from_run_id);
