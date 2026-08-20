import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migration = readFileSync(new URL("migrations/0003_phase3_cloud_schema_drift.sql", root), "utf8");
const script = readFileSync(new URL("scripts/phase3_shadow_migration.py", root), "utf8");

test("Phase 3 migration accounts for Cloud D1 drift in typed tables", () => {
  for (const table of [
    "notes",
    "settings",
    "runtime_secrets",
    "dm_commands",
    "outbound_events",
    "pilot_runs",
    "pilot_items",
    "pilot_candidate_cache",
    "inbound_webhook_events",
    "d1_migrations",
    "phase3_import_checks",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS reel_brain\\.${table}\\b`));
  }
  assert.match(migration, /ALTER TABLE reel_brain\.jobs ALTER COLUMN dedupe_key DROP NOT NULL/);
  assert.match(migration, /jobs_source_message_id_unique_idx/);
  assert.match(migration, /jobs_dedupe_key_cloud_unique_idx/);
  assert.match(migration, /artifacts_source_artifact_id_unique_idx/);
  assert.match(migration, /artifacts_object_key_unique_idx/);
  assert.match(migration, /source_artifact_id text/);
  assert.match(migration, /source_sha256 text/);
  assert.match(migration, /source_byte_size bigint/);
});

test("Phase 3 mapper redacts runtime secrets and imports typed operational schema", () => {
  assert.match(script, /import-d1-operational/);
  assert.match(script, /postgres_operational_sql/);
  assert.match(script, /import_runtime_secret_sql/);
  assert.match(script, /__REDACTED__/);
  assert.match(script, /runtime secret ciphertext and IV values are not imported/);
  assert.match(script, /phase3_import_checks/);
  assert.doesNotMatch(script, /wrangler deploy/);
  assert.doesNotMatch(script, /REEL_QUEUE/);
});
