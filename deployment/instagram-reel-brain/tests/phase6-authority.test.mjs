import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PHASE6_CLAIM_CONFIRMATION,
  PHASE6_LOCAL_CONFIRMATION,
  phase6AuthorityAllowsCloudClaims,
  phase6AuthorityAllowsLocalClaims,
  phase6PilotKey,
  phase6ShouldFenceNewJob,
  validatePhase6AuthorityRequest,
  validatePhase6ClaimRequest,
} from "../src/phase6-authority.ts";

const migration = readFileSync(new URL("../migrations/0024_phase6_processing_authority.sql", import.meta.url), "utf8");
const workerSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

const cloud = { mode: "cloud", generation: 0, dispatch_enabled: 0, codex_enabled: 0, outbound_enabled: 0, backlog_enabled: 0, cutover_watermark: null };
const local = { mode: "self_hosted", generation: 1, dispatch_enabled: 1, codex_enabled: 1, outbound_enabled: 1, backlog_enabled: 0, cutover_watermark: "2026-08-23T01:00:00Z" };

test("Phase 6 authority helpers enforce exclusive claims and post-watermark fencing", () => {
  assert.equal(phase6AuthorityAllowsCloudClaims(cloud), true);
  assert.equal(phase6AuthorityAllowsLocalClaims(cloud), false);
  assert.equal(phase6AuthorityAllowsCloudClaims(local), false);
  assert.equal(phase6AuthorityAllowsLocalClaims(local), true);
  assert.equal(phase6ShouldFenceNewJob(local, "2026-08-23T01:00:00Z"), true);
  assert.equal(phase6ShouldFenceNewJob(local, "2026-08-23T00:59:59Z"), false);
  assert.equal(phase6PilotKey(1, "job-1"), "phase6:1:job-1");
});

test("Phase 6 validators require exact confirmation, generation and identity", () => {
  assert.throws(() => validatePhase6AuthorityRequest({ expected_generation: 0, confirmation: "wrong" }, PHASE6_LOCAL_CONFIRMATION), /confirmation/);
  assert.equal(validatePhase6AuthorityRequest({ expected_generation: 0, confirmation: PHASE6_LOCAL_CONFIRMATION }, PHASE6_LOCAL_CONFIRMATION).expectedGeneration, 0);
  const claim = validatePhase6ClaimRequest({
    expected_generation: 1,
    confirmation: PHASE6_CLAIM_CONFIRMATION,
    pilot_key: "phase6:1:job-1",
    job_id: "job-1",
    source_message_id: "message-1",
    lease_owner: "phase6-local-worker-1",
    lease_minutes: 999,
  }, PHASE6_CLAIM_CONFIRMATION);
  assert.equal(claim.leaseMinutes, 360);
});

test("Phase 6 schema forbids backlog and simultaneous authority", () => {
  assert.match(migration, /CHECK \(backlog_enabled = 0\)/);
  assert.match(migration, /mode='self_hosted'.*dispatch_enabled=1.*codex_enabled=1.*outbound_enabled=1/s);
  assert.match(migration, /mode IN \('cloud','transition'\).*dispatch_enabled=0.*codex_enabled=0.*outbound_enabled=0/s);
  assert.match(migration, /processing_authority_events/);
});

test("Phase 6 prefetch endpoint is authenticated, read-only and excludes active or non-Reel work", () => {
  assert.match(workerSource, /\/api\/admin\/phase6\/prefetch-next/);
  assert.match(workerSource, /request\.method === "GET"\) return handlePhase6PrefetchNext/);
  assert.match(workerSource, /f\.status='armed'/);
  assert.match(workerSource, /j\.status='queued'/);
  assert.match(workerSource, /j\.source_url LIKE '%\/reel\/%'/);
});
