import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const phase2Migration = readFileSync(new URL("migrations/0002_phase2_local_contracts.sql", root), "utf8");
const envExample = readFileSync(new URL(".env.example", root), "utf8");
const mediaApi = readFileSync(new URL("services/media-processor-api/app.py", root), "utf8");

test("Phase 2 migration creates PostgreSQL contracts without production import statements", () => {
  for (const table of ["jobs", "job_events", "resources", "artifacts", "pending_dm_parts", "instagram_carousel_resolutions"]) {
    assert.match(phase2Migration, new RegExp(`CREATE TABLE IF NOT EXISTS reel_brain\\.${table}`));
  }
  assert.match(phase2Migration, /jobs_dedupe_active_idx/);
  assert.match(phase2Migration, /instagram_carousel_resolutions/);
  assert.doesNotMatch(phase2Migration, /COPY\s|d1|r2|kv|instagram\.com/i);
});

test("Environment contract keeps execution and mutation flags disabled", () => {
  for (const key of [
    "REEL_INTAKE_ENABLED",
    "REEL_DISPATCH_ENABLED",
    "REEL_WORKER_ENABLED",
    "REEL_CODEX_ENABLED",
    "REEL_OUTBOUND_ENABLED",
    "REEL_MUTATIONS_ENABLED",
    "REEL_BACKLOG_ENABLED",
    "REEL_PUBLISHER_ENABLED",
    "REEL_ARCHIVER_ENABLED",
    "REEL_AUTH_ROTATOR_ENABLED",
  ]) {
    assert.match(envExample, new RegExp(`${key}=false`));
  }
});

test("Media processor API is internal and fixture-only by default", () => {
  assert.match(mediaApi, /REEL_MEDIA_PROCESSOR_ENABLED", "false"/);
  assert.match(mediaApi, /REEL_MEDIA_FIXTURE_ONLY", "true"/);
  assert.match(mediaApi, /127\.0\.0\.1/);
  assert.match(mediaApi, /x-reel-internal-token/);
  assert.doesNotMatch(mediaApi, /instagram\.com|openai|codex|cloudflare/i);
});
