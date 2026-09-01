ALTER TABLE research_runs
  ADD COLUMN IF NOT EXISTS codex_runtime_seconds numeric;

