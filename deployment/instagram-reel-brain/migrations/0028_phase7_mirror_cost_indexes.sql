-- Phase 7 uses D1 as an edge spool and advances a durable local cursor.
-- These indexes keep each incremental read proportional to new rows rather
-- than the entire post-cutover history.
CREATE INDEX IF NOT EXISTS jobs_mirror_cursor_idx ON jobs(updated_at, id);
CREATE INDEX IF NOT EXISTS job_events_mirror_cursor_idx ON job_events(created_at, id);
CREATE INDEX IF NOT EXISTS artifacts_mirror_cursor_idx ON artifacts(created_at, id);
CREATE INDEX IF NOT EXISTS resources_mirror_cursor_idx ON resources(created_at, id);
CREATE INDEX IF NOT EXISTS notes_mirror_cursor_idx ON notes(created_at, id);
CREATE INDEX IF NOT EXISTS outbound_events_mirror_cursor_idx ON outbound_events(created_at, id);
CREATE INDEX IF NOT EXISTS carousel_resolutions_mirror_cursor_idx ON instagram_carousel_resolutions(updated_at, source_message_id);
CREATE INDEX IF NOT EXISTS inbound_webhook_mirror_cursor_idx ON inbound_webhook_events(updated_at, source_message_id);
CREATE INDEX IF NOT EXISTS resources_guide_object_idx ON resources(guide_html_key, created_at);
