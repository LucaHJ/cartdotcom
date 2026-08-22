import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  PHASE5_ARM_CONFIRMATION,
  PHASE5_CANCEL_ARM_CONFIRMATION,
  PHASE5_FENCE_CONFIRMATION,
  PHASE5_START_CONFIRMATION,
  PHASE5_FINALIZE_CONFIRMATION,
  PHASE5_MIN_EXPLICIT_JOB_CREATED_AT,
  PHASE5_ABORT_CONFIRMATION,
  PHASE5_RENEW_CONFIRMATION,
  PHASE5_ROLLBACK_CONFIRMATION,
  phase5ArmCanCaptureShare,
  phase5FenceActive,
  phase5FenceExpired,
  validatePhase5FenceRequest,
  validatePhase5PreintakeArmRequest,
  validatePhase5PreintakeCancelRequest,
  validatePhase5RenewRequest,
  validatePhase5RollbackRequest,
  validatePhase5StartRequest,
  validatePhase5FinalizeRequest,
  validatePhase5AbortRequest,
  phase5StartRecoveryDecision,
  phase5FinalizeRecoveryDecision,
  phase5AbortRecoveryDecision,
} from "../src/phase5-pilot.ts";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/0021_phase5_local_pilot_fence.sql", import.meta.url), "utf8");
const armMigration = readFileSync(new URL("../migrations/0022_phase5_preintake_arm.sql", import.meta.url), "utf8");
const phase5Owner = "phase5-local-worker-1";
const phase5Hash = "a".repeat(64);

function phase5Snapshot(overrides = {}) {
  return {
    status: "local_claimed",
    job_status: "queued",
    job_stage: "queued",
    local_lease_owner: phase5Owner,
    upload_token_hash: null,
    upload_token_expires_at: null,
    html_key: null,
    library_path: null,
    completed_at: null,
    publication_artifacts: 0,
    completion_events: 0,
    marker_events: 0,
    ...overrides,
  };
}

function simulateStart(snapshot, { callbackTokenHash = phase5Hash, fault = "" } = {}) {
  const state = { ...snapshot };
  const effects = { reactions: 0, start_audits: Number(state.marker_events || 0) };
  const decision = phase5StartRecoveryDecision(state, { leaseOwner: phase5Owner, callbackTokenHash });
  if (!decision.ok) return { state, effects, decision };
  if (decision.status === "guarded_start") {
    state.status = "local_processing";
    if (fault === "after_fence_update") return { state, effects, decision };
    state.job_status = "running";
    state.job_stage = "downloading";
    state.upload_token_hash = callbackTokenHash;
    if (fault === "after_job_update_before_audit") return { state, effects, decision };
  } else if (decision.status === "repair_queued_start") {
    state.job_status = "running";
    state.job_stage = "downloading";
    state.upload_token_hash = callbackTokenHash;
  }
  if ((decision.status === "guarded_start" || decision.status === "repair_queued_start" || decision.status === "resume_running") && Number(state.marker_events || 0) === 0) {
    state.marker_events = 1;
    effects.start_audits = 1;
    effects.reactions += 1;
  }
  if (fault === "after_audit_before_response") return { state, effects, decision };
  if (decision.status === "processor_already_complete" && decision.repairAudit && Number(state.marker_events || 0) === 0) {
    state.marker_events = 1;
    effects.start_audits = 1;
  }
  return { state, effects, decision };
}

function simulateFinalize(snapshot, { fault = "" } = {}) {
  const state = { ...snapshot };
  const effects = { finalize_updates: 0, finalize_audits: Number(state.marker_events || 0) };
  const decision = phase5FinalizeRecoveryDecision(state, { leaseOwner: phase5Owner });
  if (!decision.ok) return { state, effects, decision };
  if (decision.status === "guarded_finalize") {
    state.status = "local_complete";
    effects.finalize_updates += 1;
    if (fault === "after_fence_update_before_audit") return { state, effects, decision };
  }
  if ((decision.status === "guarded_finalize" || decision.status === "repair_finalize_audit") && Number(state.marker_events || 0) === 0) {
    state.marker_events = 1;
    effects.finalize_audits = 1;
  }
  return { state, effects, decision };
}

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

test("Phase 5 renewal request requires exact identity, owner and caps renewal to six hours", () => {
  assert.throws(
    () => validatePhase5RenewRequest({
      pilot_key: "phase5-reel-1",
      job_id: "job-new-1",
      source_message_id: "mid.1",
      lease_owner: "phase5-local-worker-1",
      confirmation: "wrong",
    }),
    /confirmation must equal/,
  );
  const now = Date.parse("2026-08-22T02:40:00.000Z");
  const validated = validatePhase5RenewRequest({
    pilot_key: "phase5-reel-1",
    job_id: "job-new-1",
    source_message_id: "mid.1",
    lease_owner: "phase5-local-worker-1",
    confirmation: PHASE5_RENEW_CONFIRMATION,
    expires_minutes: 999,
    reason: "implementation window",
  }, now);
  assert.equal(validated.pilotKey, "phase5-reel-1");
  assert.equal(validated.jobId, "job-new-1");
  assert.equal(validated.sourceMessageId, "mid.1");
  assert.equal(validated.leaseOwner, "phase5-local-worker-1");
  assert.equal(validated.expiresAt, "2026-08-22T08:40:00.000Z");
  assert.equal(validated.reason, "implementation window");
});

test("Phase 5 exact runner control requests require confirmation, owner, source id and idempotency", () => {
  const now = Date.parse("2026-08-22T03:00:00.000Z");
  const identity = {
    pilot_key: "phase5-reel-1",
    job_id: "job-new-1",
    source_message_id: "mid.1",
    lease_owner: "phase5-local-worker-1",
    idempotency_key: "runner-attempt-1",
  };
  assert.throws(
    () => validatePhase5StartRequest({
      ...identity,
      callback_token_hash: "a".repeat(64),
      confirmation: "wrong",
    }, now),
    /confirmation must equal/,
  );
  const started = validatePhase5StartRequest({
    ...identity,
    callback_token_hash: "a".repeat(64),
    confirmation: PHASE5_START_CONFIRMATION,
    token_minutes: 999,
  }, now);
  assert.equal(started.leaseOwner, "phase5-local-worker-1");
  assert.equal(started.callbackTokenHash, "a".repeat(64));
  assert.equal(started.tokenExpiresAt, "2026-08-22T09:00:00.000Z", "callback tokens are capped at six hours");
  assert.equal(started.marker, "phase5-control:phase5-reel-1:start:runner-attempt-1");

  const finalized = validatePhase5FinalizeRequest({
    ...identity,
    confirmation: PHASE5_FINALIZE_CONFIRMATION,
  });
  assert.equal(finalized.marker, "phase5-control:phase5-reel-1:finalize:runner-attempt-1");

  const aborted = validatePhase5AbortRequest({
    ...identity,
    confirmation: PHASE5_ABORT_CONFIRMATION,
    reason: "pre-publication rollback",
  });
  assert.equal(aborted.marker, "phase5-control:phase5-reel-1:abort:runner-attempt-1");
  assert.equal(aborted.reason, "pre-publication rollback");
});

test("Phase 5 start recovery decision covers the exact crash/restart matrix", () => {
  assert.equal(
    phase5StartRecoveryDecision(phase5Snapshot(), { leaseOwner: phase5Owner, callbackTokenHash: phase5Hash }).status,
    "guarded_start",
  );

  const runningRepair = phase5StartRecoveryDecision(
    phase5Snapshot({ status: "local_processing", job_status: "running", upload_token_hash: phase5Hash, marker_events: 0 }),
    { leaseOwner: phase5Owner, callbackTokenHash: phase5Hash },
  );
  assert.equal(runningRepair.status, "resume_running");
  assert.equal(runningRepair.repairAudit, true);

  const alreadyComplete = phase5StartRecoveryDecision(
    phase5Snapshot({ status: "local_processing", job_status: "complete", completed_at: "2026-08-22T03:20:00Z", marker_events: 0 }),
    { leaseOwner: phase5Owner },
  );
  assert.equal(alreadyComplete.status, "processor_already_complete");
  assert.equal(alreadyComplete.processorAlreadyComplete, true);
  assert.equal(alreadyComplete.repairAudit, true);

  assert.equal(
    phase5StartRecoveryDecision(
      phase5Snapshot({ status: "local_complete", job_status: "complete", completed_at: "2026-08-22T03:20:00Z", marker_events: 1 }),
      { leaseOwner: phase5Owner },
    ).recoveryStatus,
    "cloud_already_finalized",
  );

  assert.equal(
    phase5StartRecoveryDecision(
      phase5Snapshot({ status: "local_processing", job_status: "queued" }),
      { leaseOwner: phase5Owner, callbackTokenHash: phase5Hash },
    ).status,
    "repair_queued_start",
  );

  assert.equal(
    phase5StartRecoveryDecision(
      phase5Snapshot({ status: "local_processing", job_status: "queued", publication_artifacts: 1 }),
      { leaseOwner: phase5Owner, callbackTokenHash: phase5Hash },
    ).recoveryStatus,
    "queued_with_publication",
  );

  assert.equal(
    phase5StartRecoveryDecision(
      phase5Snapshot({ local_lease_owner: "other-worker" }),
      { leaseOwner: phase5Owner, callbackTokenHash: phase5Hash },
    ).recoveryStatus,
    "lease_owner_mismatch",
  );

  assert.equal(
    phase5StartRecoveryDecision(phase5Snapshot(), { leaseOwner: phase5Owner }).recoveryStatus,
    "callback_hash_required",
  );
});

test("Phase 5 finalize recovery decision repairs missing audit before idempotent success", () => {
  assert.equal(
    phase5FinalizeRecoveryDecision(
      phase5Snapshot({ status: "local_processing", job_status: "complete", completed_at: "2026-08-22T03:20:00Z" }),
      { leaseOwner: phase5Owner },
    ).status,
    "guarded_finalize",
  );

  const missingAudit = phase5FinalizeRecoveryDecision(
    phase5Snapshot({ status: "local_complete", job_status: "complete", completed_at: "2026-08-22T03:20:00Z", marker_events: 0 }),
    { leaseOwner: phase5Owner },
  );
  assert.equal(missingAudit.status, "repair_finalize_audit");
  assert.equal(missingAudit.repairAudit, true);

  assert.equal(
    phase5FinalizeRecoveryDecision(
      phase5Snapshot({ status: "local_complete", job_status: "complete", completed_at: "2026-08-22T03:20:00Z", marker_events: 1 }),
      { leaseOwner: phase5Owner },
    ).status,
    "idempotent_finalized",
  );
});

test("Phase 5 executable recovery simulation repairs crash boundaries without duplicate effects", () => {
  const afterFence = simulateStart(phase5Snapshot(), { fault: "after_fence_update" });
  assert.deepEqual(
    { fence: afterFence.state.status, job: afterFence.state.job_status, audits: afterFence.effects.start_audits },
    { fence: "local_processing", job: "queued", audits: 0 },
  );
  const repairedFence = simulateStart(afterFence.state);
  assert.equal(repairedFence.decision.status, "repair_queued_start");
  assert.equal(repairedFence.state.job_status, "running");
  assert.equal(repairedFence.effects.reactions, 1);

  const afterJob = simulateStart(phase5Snapshot(), { fault: "after_job_update_before_audit" });
  const repairedAudit = simulateStart(afterJob.state);
  assert.equal(repairedAudit.decision.status, "resume_running");
  assert.equal(repairedAudit.effects.start_audits, 1);
  assert.equal(repairedAudit.effects.reactions, 1);

  const afterAudit = simulateStart(phase5Snapshot(), { fault: "after_audit_before_response" });
  const resumedAfterAudit = simulateStart(afterAudit.state);
  assert.equal(resumedAfterAudit.decision.status, "resume_running");
  assert.equal(resumedAfterAudit.effects.reactions, 0, "same reaction is not sent again when the start marker exists");

  const processorCompleteBeforeCheckpoint = phase5Snapshot({
    status: "local_processing",
    job_status: "complete",
    completed_at: "2026-08-22T03:20:00Z",
    publication_artifacts: 3,
    completion_events: 1,
    marker_events: 1,
  });
  const recoveredStart = simulateStart(processorCompleteBeforeCheckpoint, { callbackTokenHash: null });
  assert.equal(recoveredStart.decision.status, "processor_already_complete");
  assert.equal(recoveredStart.decision.processorAlreadyComplete, true);

  const finalizeCrash = simulateFinalize(
    phase5Snapshot({ status: "local_processing", job_status: "complete", completed_at: "2026-08-22T03:20:00Z", marker_events: 0 }),
    { fault: "after_fence_update_before_audit" },
  );
  assert.equal(finalizeCrash.state.status, "local_complete");
  assert.equal(finalizeCrash.effects.finalize_audits, 0);
  const repairedFinalizeAudit = simulateFinalize(finalizeCrash.state);
  assert.equal(repairedFinalizeAudit.decision.status, "repair_finalize_audit");
  assert.equal(repairedFinalizeAudit.effects.finalize_updates, 0, "idempotent finalize repair does not repeat the fence update");
  assert.equal(repairedFinalizeAudit.effects.finalize_audits, 1);

  const afterCloudFinalizeBeforeLocalCompletion = phase5Snapshot({
    status: "local_complete",
    job_status: "complete",
    completed_at: "2026-08-22T03:20:00Z",
    publication_artifacts: 3,
    completion_events: 1,
    marker_events: 1,
  });
  assert.equal(
    phase5StartRecoveryDecision(afterCloudFinalizeBeforeLocalCompletion, { leaseOwner: phase5Owner }).recoveryStatus,
    "cloud_already_finalized",
  );
  assert.equal(
    phase5FinalizeRecoveryDecision(afterCloudFinalizeBeforeLocalCompletion, { leaseOwner: phase5Owner }).status,
    "idempotent_finalized",
  );
});

test("Phase 5 duplicate abort delivery is documented as at-least-once queue retry guarded by fence state", () => {
  const aborted = phase5Snapshot({ status: "rolled_back", job_status: "queued", marker_events: 1 });
  assert.equal(
    phase5AbortRecoveryDecision(aborted, { leaseOwner: phase5Owner }).status,
    "idempotent_aborted",
  );
  assert.equal(
    phase5AbortRecoveryDecision(phase5Snapshot({ status: "rolled_back", job_status: "queued", marker_events: 0 }), { leaseOwner: phase5Owner }).status,
    "requeue_audit_missing",
  );
  assert.equal(
    phase5AbortRecoveryDecision(phase5Snapshot({ status: "local_processing", job_status: "complete", completion_events: 1 }), { leaseOwner: phase5Owner }).recoveryStatus,
    "publication_exists",
  );
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
  const startRouteIndex = source.indexOf('"/api/admin/phase5/local-pilot/start"', handleApiIndex);
  const finalizeRouteIndex = source.indexOf('"/api/admin/phase5/local-pilot/finalize"', handleApiIndex);
  const abortRouteIndex = source.indexOf('"/api/admin/phase5/local-pilot/abort"', handleApiIndex);
  const phase4RouteIndex = source.indexOf('"/api/phase4/mirror/"', handleApiIndex);

  assert.ok(phase4RouteIndex > handleApiIndex && phase4RouteIndex < adminGateIndex, "Phase 4 read-only mirror remains before admin gate");
  assert.ok(fenceRouteIndex > adminGateIndex, "Phase 5 fence must be behind admin gate");
  assert.ok(rollbackRouteIndex > adminGateIndex, "Phase 5 rollback must be behind admin gate");
  assert.ok(startRouteIndex > adminGateIndex, "Phase 5 start must be behind admin gate");
  assert.ok(finalizeRouteIndex > adminGateIndex, "Phase 5 finalize must be behind admin gate");
  assert.ok(abortRouteIndex > adminGateIndex, "Phase 5 abort must be behind admin gate");
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
  const renewRouteIndex = source.indexOf('"/api/admin/phase5/local-pilot/renew"', handleApiIndex);
  assert.ok(armRouteIndex > adminGateIndex, "pre-intake arm route must be behind admin gate");
  assert.ok(cancelRouteIndex > adminGateIndex, "pre-intake cancel route must be behind admin gate");
  assert.ok(renewRouteIndex > adminGateIndex, "lease renewal route must be behind admin gate");

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

test("Phase 5 renewal route fails closed on queued exact-job claim without completion or publication", () => {
  const renewIndex = source.indexOf("async function handlePhase5RenewLease");
  assert.ok(renewIndex > 0);
  assert.ok(source.indexOf("validatePhase5RenewRequest", renewIndex) > renewIndex);
  assert.ok(source.indexOf("f.pilot_key=? AND f.job_id=? AND f.source_message_id=?", renewIndex) > renewIndex);
  assert.ok(source.indexOf('row.status !== "local_claimed"', renewIndex) > renewIndex);
  assert.ok(source.indexOf("row.local_lease_owner !== validated.leaseOwner", renewIndex) > renewIndex);
  assert.ok(source.indexOf('row.job_status !== "queued"', renewIndex) > renewIndex);
  assert.ok(source.indexOf("row.html_key || row.library_path || row.completed_at", renewIndex) > renewIndex);
  assert.ok(source.indexOf("publication_artifacts", renewIndex) > renewIndex);
  assert.ok(source.indexOf("completion_events", renewIndex) > renewIndex);
  assert.ok(source.indexOf("updated.meta.changes", renewIndex) > renewIndex);
  assert.ok(source.indexOf("job is no longer renewable", renewIndex) > renewIndex);
  assert.ok(source.indexOf("phase5_local_lease_renewed", renewIndex) > renewIndex);
});

test("Phase 5 exact control routes guard every cloud transition before audit or queue effects", () => {
  const startIndex = source.indexOf("async function handlePhase5StartLocalProcessing");
  const finalizeIndex = source.indexOf("async function handlePhase5FinalizeLocalProcessing");
  const abortIndex = source.indexOf("async function handlePhase5AbortLocalProcessing");
  assert.ok(startIndex > 0);
  assert.ok(finalizeIndex > startIndex);
  assert.ok(abortIndex > finalizeIndex);

  const startBody = source.slice(startIndex, finalizeIndex);
  assert.match(startBody, /validatePhase5StartRequest/);
  assert.match(startBody, /phase5StartRecoveryDecision/);
  assert.match(startBody, /decision\.status === "resume_running"/);
  assert.match(startBody, /decision\.status === "processor_already_complete"/);
  assert.match(startBody, /decision\.status === "repair_queued_start"/);
  assert.match(startBody, /fenceUpdate\.meta\.changes/);
  assert.match(startBody, /compensation\.meta\.changes/);
  assert.match(startBody, /compensated_to_local_claimed/);
  assert.match(startBody, /ambiguous_partial_start/);
  assert.match(startBody, /phase5EnsureStartAudit/);
  assert.match(startBody, /const repaired = await phase5RepairQueuedStart[\s\S]+const repairedAudit = await phase5EnsureStartAudit/);
  assert.match(startBody, /postcondition failed/);
  assert.doesNotMatch(startBody, /["']callback_token["']\s*:/, "start route must not accept or return callback token plaintext");

  const finalizeBody = source.slice(finalizeIndex, abortIndex);
  assert.match(finalizeBody, /validatePhase5FinalizeRequest/);
  assert.match(finalizeBody, /phase5FinalizeRecoveryDecision/);
  assert.match(finalizeBody, /decision\.status === "idempotent_finalized" \|\| decision\.status === "repair_finalize_audit"/);
  assert.match(finalizeBody, /updated\.meta\.changes/);
  assert.match(finalizeBody, /if \(\(updated\.meta\.changes \|\| 0\) !== 1\)[\s\S]+const insertedAudit = await phase5EnsureFinalizeAudit/);
  assert.match(finalizeBody, /AND EXISTS \(SELECT 1 FROM jobs j WHERE j\.id=phase5_local_pilot_fences\.job_id AND j\.status='complete'\)/);
  assert.match(finalizeBody, /finalize postcondition failed/);

  const abortBody = source.slice(abortIndex, source.indexOf("async function handlePhase5PreintakeArm", abortIndex));
  assert.match(abortBody, /validatePhase5AbortRequest/);
  assert.match(abortBody, /phase5AbortRecoveryDecision/);
  assert.match(abortBody, /decision\.status === "idempotent_aborted"/);
  assert.match(abortBody, /jobUpdate\.meta\.changes/);
  assert.match(abortBody, /fenceUpdate\.meta\.changes/);
  assert.ok(abortBody.indexOf("fenceUpdate.meta.changes") < abortBody.indexOf("env.REEL_QUEUE.send"), "cloud requeue must happen only after the guarded rollback is recorded");
  assert.match(abortBody, /requeue_audit_missing|guarded_abort/);
});

test("Phase 5 callback validation refuses fenced jobs after rollback, expiry or owner mismatch", () => {
  const callbackIndex = source.indexOf("async function validateCallback");
  assert.ok(callbackIndex > 0);
  assert.ok(source.indexOf("phase5_local_pilot_fences", callbackIndex) > callbackIndex);
  assert.ok(source.indexOf('phase5Fence.status !== "local_processing"', callbackIndex) > callbackIndex);
  assert.ok(source.indexOf("Date.parse(phase5Fence.local_lease_expires_at) < Date.now()", callbackIndex) > callbackIndex);
  assert.ok(source.indexOf("!phase5Fence.local_lease_owner", callbackIndex) > callbackIndex);
});
