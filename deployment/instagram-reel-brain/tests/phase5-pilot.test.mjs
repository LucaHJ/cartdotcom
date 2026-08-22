import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PHASE5_FENCE_CONFIRMATION,
  PHASE5_MIN_EXPLICIT_JOB_CREATED_AT,
  PHASE5_ROLLBACK_CONFIRMATION,
  phase5FenceActive,
  phase5FenceExpired,
  validatePhase5FenceRequest,
  validatePhase5RollbackRequest,
} from "../src/phase5-pilot.ts";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0021_phase5_local_pilot_fence.sql", import.meta.url), "utf8");

test("Phase 5 fence request requires exact durable identifiers and confirmation", () => {
  assert.throws(
    () => validatePhase5FenceRequest({
      pilot_key: "phase5-reel-1",
      job_id: "job-new-1",
      source_message_id: "mid.1",
      confirmation: "wrong",
    }),
    /confirmation must equal/,
  );
  const validated = validatePhase5FenceRequest({
    pilot_key: "phase5-reel-1",
    job_id: "job-new-1",
    source_message_id: "mid.1",
    confirmation: PHASE5_FENCE_CONFIRMATION,
    expires_minutes: 6,
  });
  assert.equal(validated.pilotKey, "phase5-reel-1");
  assert.equal(validated.jobId, "job-new-1");
  assert.equal(validated.sourceMessageId, "mid.1");
  assert.ok(Date.parse(validated.expiresAt) > Date.now());
});

test("Phase 5 rollback request requires exact confirmation and reason is bounded", () => {
  assert.throws(
    () => validatePhase5RollbackRequest({ pilot_key: "phase5-reel-1", job_id: "job-new-1", confirmation: "wrong" }),
    /confirmation must equal/,
  );
  const validated = validatePhase5RollbackRequest({
    pilot_key: "phase5-reel-1",
    job_id: "job-new-1",
    confirmation: PHASE5_ROLLBACK_CONFIRMATION,
    reason: "synthetic rollback",
  });
  assert.equal(validated.reason, "synthetic rollback");
});

test("Phase 5 active fences expire fail-closed", () => {
  assert.equal(phase5FenceExpired({ expires_at: "2026-08-21T00:00:00.000Z" }, Date.parse("2026-08-21T00:00:01.000Z")), true);
  assert.equal(
    phase5FenceActive({
      pilot_key: "phase5-reel-1",
      job_id: "job-new-1",
      source_message_id: "mid.1",
      status: "armed",
      expires_at: "2026-08-21T00:00:02.000Z",
    }, Date.parse("2026-08-21T00:00:01.000Z")),
    true,
  );
  assert.equal(
    phase5FenceActive({
      pilot_key: "phase5-reel-1",
      job_id: "job-new-1",
      source_message_id: "mid.1",
      status: "rolled_back",
      expires_at: "2026-08-21T00:00:02.000Z",
    }, Date.parse("2026-08-21T00:00:01.000Z")),
    false,
  );
});

test("Phase 5 cloud routes remain admin-only and do not add unauthenticated mutation surfaces", () => {
  const handleApiIndex = source.indexOf("async function handleApi");
  const adminGateIndex = source.indexOf("const unauthorized = requireAdmin(request, env);", handleApiIndex);
  const fenceRouteIndex = source.indexOf('"/api/admin/phase5/local-pilot/fence"', handleApiIndex);
  const rollbackRouteIndex = source.indexOf('"/api/admin/phase5/local-pilot/rollback"', handleApiIndex);
  const phase4RouteIndex = source.indexOf('"/api/phase4/mirror/"', handleApiIndex);

  assert.ok(phase4RouteIndex > handleApiIndex && phase4RouteIndex < adminGateIndex, "Phase 4 read-only mirror remains before admin gate");
  assert.ok(fenceRouteIndex > adminGateIndex, "Phase 5 fence must be behind admin gate");
  assert.ok(rollbackRouteIndex > adminGateIndex, "Phase 5 rollback must be behind admin gate");
  assert.doesNotMatch(source.slice(handleApiIndex, adminGateIndex), /phase5\/local-pilot/);
});

test("Phase 5 cloud processor checks the active fence before running container work", () => {
  const processJobIndex = source.indexOf("async function processJob");
  const fenceCheckIndex = source.indexOf("activePhase5FenceForJob(env, job.id)", processJobIndex);
  const updateRunningIndex = source.indexOf("UPDATE jobs SET status='running'", processJobIndex);
  const containerIndex = source.indexOf("container.fetch(new Request", processJobIndex);

  assert.ok(fenceCheckIndex > processJobIndex, "processor should check the Phase 5 fence");
  assert.ok(fenceCheckIndex < updateRunningIndex, "fence check must happen before cloud marks the job running");
  assert.ok(fenceCheckIndex < containerIndex, "fence check must happen before container/Codex execution");
  assert.match(source, /PHASE5_MIN_EXPLICIT_JOB_CREATED_AT/);
  assert.equal(PHASE5_MIN_EXPLICIT_JOB_CREATED_AT, "2026-08-21T15:01:28.000Z");
});

test("Phase 5 D1 table is a narrow one-job fence/audit surface", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS phase5_local_pilot_fences/);
  assert.match(migration, /pilot_key TEXT PRIMARY KEY/);
  assert.match(migration, /job_id TEXT NOT NULL UNIQUE/);
  assert.match(migration, /CHECK \(status IN \('armed','local_claimed','local_processing','local_complete','rolled_back','expired'\)\)/);
  assert.doesNotMatch(migration, /\bINSERT\b|\bUPDATE jobs\b|\bREEL_QUEUE\b/i);
});
