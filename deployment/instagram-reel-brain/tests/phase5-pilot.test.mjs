import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  PHASE5_ARM_CONFIRMATION,
  PHASE5_CANCEL_ARM_CONFIRMATION,
  PHASE5_FENCE_CONFIRMATION,
  PHASE5_MIN_EXPLICIT_JOB_CREATED_AT,
  PHASE5_ROLLBACK_CONFIRMATION,
  phase5ArmCanCaptureShare,
  phase5FenceActive,
  phase5FenceExpired,
  validatePhase5FenceRequest,
  validatePhase5PreintakeArmRequest,
  validatePhase5PreintakeCancelRequest,
  validatePhase5RollbackRequest,
} from "../src/phase5-pilot.ts";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0021_phase5_local_pilot_fence.sql", import.meta.url), "utf8");
const armMigration = readFileSync(new URL("../migrations/0022_phase5_preintake_arm.sql", import.meta.url), "utf8");

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

test("Phase 5 pre-intake arm requires exact sender, confirmation and short expiry", () => {
  assert.throws(
    () => validatePhase5PreintakeArmRequest({
      arm_key: "phase5-next-reel",
      sender_id: "4313779425530608",
      confirmation: "wrong",
    }),
    /confirmation must equal/,
  );
  const now = Date.parse("2026-08-22T02:00:00.000Z");
  const armed = validatePhase5PreintakeArmRequest({
    arm_key: "phase5-next-reel",
    sender_id: "4313779425530608",
    confirmation: PHASE5_ARM_CONFIRMATION,
    expires_minutes: 90,
  }, now);
  assert.equal(armed.armKey, "phase5-next-reel");
  assert.equal(armed.senderId, "4313779425530608");
  assert.equal(armed.armedAt, "2026-08-22T02:00:00.000Z");
  assert.equal(armed.expiresAt, "2026-08-22T02:15:00.000Z", "pre-intake arms are capped at 15 minutes");

  assert.throws(
    () => validatePhase5PreintakeCancelRequest({ arm_key: "phase5-next-reel", confirmation: "wrong" }),
    /confirmation must equal/,
  );
  assert.equal(
    validatePhase5PreintakeCancelRequest({
      arm_key: "phase5-next-reel",
      confirmation: PHASE5_CANCEL_ARM_CONFIRMATION,
      reason: "operator cancelled",
    }).reason,
    "operator cancelled",
  );
});

test("Phase 5 arm captures only an unexpired matching Reel from the armed sender", () => {
  const arm = {
    arm_key: "phase5-next-reel",
    sender_id: "4313779425530608",
    media_type: "reel",
    status: "armed",
    armed_at: "2026-08-22T02:00:00.000Z",
    expires_at: "2026-08-22T02:15:00.000Z",
  };
  assert.equal(phase5ArmCanCaptureShare(arm, {
    senderId: "4313779425530608",
    mediaType: "reel",
    now: Date.parse("2026-08-22T02:05:00.000Z"),
  }), true);
  assert.equal(phase5ArmCanCaptureShare(arm, {
    senderId: "999",
    mediaType: "reel",
    now: Date.parse("2026-08-22T02:05:00.000Z"),
  }), false);
  assert.equal(phase5ArmCanCaptureShare(arm, {
    senderId: "4313779425530608",
    mediaType: "post",
    now: Date.parse("2026-08-22T02:05:00.000Z"),
  }), false);
  assert.equal(phase5ArmCanCaptureShare(arm, {
    senderId: "4313779425530608",
    mediaType: "reel",
    now: Date.parse("2026-08-22T02:16:00.000Z"),
  }), false);
});

test("Phase 5 pre-intake D1 migration enforces max-one active arm and preserves captured evidence", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(armMigration);
  db.prepare(
    `INSERT INTO phase5_preintake_arms(arm_key,sender_id,media_type,status,armed_at,expires_at)
     VALUES ('arm-a','4313779425530608','reel','armed','2026-08-22T02:00:00.000Z','2026-08-22T02:15:00.000Z')`,
  ).run();
  assert.throws(
    () => db.prepare(
      `INSERT INTO phase5_preintake_arms(arm_key,sender_id,media_type,status,armed_at,expires_at)
       VALUES ('arm-b','4313779425530608','reel','armed','2026-08-22T02:01:00.000Z','2026-08-22T02:15:00.000Z')`,
    ).run(),
    /UNIQUE/,
  );
  db.prepare(
    `UPDATE phase5_preintake_arms
     SET status='captured',source_message_id='mid-1',job_id='job-1',consumed_at='2026-08-22T02:02:00.000Z'
     WHERE arm_key='arm-a'`,
  ).run();
  db.prepare(
    `INSERT INTO phase5_preintake_arms(arm_key,sender_id,media_type,status,armed_at,expires_at)
     VALUES ('arm-c','4313779425530608','reel','armed','2026-08-22T02:03:00.000Z','2026-08-22T02:15:00.000Z')`,
  ).run();
  const captured = { ...db.prepare("SELECT source_message_id,job_id,status FROM phase5_preintake_arms WHERE arm_key='arm-a'").get() };
  assert.deepEqual(captured, { source_message_id: "mid-1", job_id: "job-1", status: "captured" });
});

test("Phase 5 pre-intake routes are admin-only and capture happens before queue send", () => {
  const handleApiIndex = source.indexOf("async function handleApi");
  const adminGateIndex = source.indexOf("const unauthorized = requireAdmin(request, env);", handleApiIndex);
  const armRouteIndex = source.indexOf('"/api/admin/phase5/local-pilot/arm-next-reel"', handleApiIndex);
  const cancelRouteIndex = source.indexOf('"/api/admin/phase5/local-pilot/cancel-arm"', handleApiIndex);
  assert.ok(armRouteIndex > adminGateIndex, "pre-intake arm route must be behind admin gate");
  assert.ok(cancelRouteIndex > adminGateIndex, "pre-intake cancel route must be behind admin gate");

  const createJobIndex = source.indexOf("async function createJob");
  const captureIndex = source.indexOf("capturePhase5PreintakeArmForJob(env", createJobIndex);
  const reactIndex = source.indexOf('reactToSourceMessage(env, { id, source_message_id', createJobIndex);
  const queueIndex = source.indexOf("sendQueueMessageWithAdjacentInstructionDelay(env.REEL_QUEUE", createJobIndex);
  assert.ok(captureIndex > createJobIndex);
  assert.ok(captureIndex < reactIndex, "capture/fence should happen before visible queued reaction");
  assert.ok(captureIndex < queueIndex, "capture/fence must happen before cloud queue publication");

  const captureHandlerIndex = source.indexOf("async function capturePhase5PreintakeArmForJob");
  assert.ok(source.indexOf('canonicalUrl.includes("/reel/")', captureHandlerIndex) > captureHandlerIndex);
  assert.ok(source.indexOf("INSERT INTO phase5_local_pilot_fences", captureHandlerIndex) > captureHandlerIndex);
  assert.ok(source.indexOf("UPDATE phase5_preintake_arms", captureHandlerIndex) > captureHandlerIndex);

  const rollbackIndex = source.indexOf("async function handlePhase5Rollback");
  assert.ok(source.indexOf("UPDATE phase5_preintake_arms", rollbackIndex) > rollbackIndex);
  assert.ok(source.indexOf("env.REEL_QUEUE.send", rollbackIndex) > source.indexOf("UPDATE phase5_preintake_arms", rollbackIndex));
});
