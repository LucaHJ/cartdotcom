ALTER TABLE jobs ADD COLUMN codex_input_tokens INTEGER;
ALTER TABLE jobs ADD COLUMN codex_cached_input_tokens INTEGER;
ALTER TABLE jobs ADD COLUMN codex_output_tokens INTEGER;
ALTER TABLE jobs ADD COLUMN codex_reasoning_output_tokens INTEGER;
ALTER TABLE jobs ADD COLUMN codex_total_tokens INTEGER;
