import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PHASE5_LOCAL_PILOT_CONFIRMATION,
  PHASE5_LOCAL_RENEW_CONFIRMATION,
  PHASE5_LOCAL_ROLLBACK_CONFIRMATION,
  PHASE5_SYNTHETIC_STAGES,
  phase5LeaseRenewalSeconds,
  validatePhase5LeaseRequest,
  validatePhase5LocalRollback,
  validatePhase5LocalRenewal,
} from "../src/domain/phase5-pilot.js";
import { runSyntheticPhase5Pipeline } from "../src/domain/phase5-synthetic-pipeline.js";
import { FixtureQueryClient } from "../src/repositories/fixture-client.js";
import { PostgresReelRepository } from "../src/repositories/postgres-reel-repository.js";
import { LocalObjectStore } from "../src/storage/local-object-store.js";

test("Phase 5 local lease validation requires exact identity and confirmation", () => {
  assert.throws(
    () => validatePhase5LeaseRequest({
      pilotKey: "phase5-reel-1",
      jobId: "job-new-1",
      sourceMessageId: "mid.1",
      confirmation: "wrong",
    }),
    /confirmation must equal/,
  );
  const lease = validatePhase5LeaseRequest({
    pilotKey: "phase5-reel-1",
    jobId: "job-new-1",
    sourceMessageId: "mid.1",
    cloudFenceKey: "phase5-reel-1",
    confirmation: PHASE5_LOCAL_PILOT_CONFIRMATION,
  });
  assert.equal(lease.pilotKey, "phase5-reel-1");
  assert.equal(lease.jobId, "job-new-1");
  assert.equal(lease.sourceMessageId, "mid.1");

  const rollback = validatePhase5LocalRollback({
    pilotKey: "phase5-reel-1",
    jobId: "job-new-1",
    sourceMessageId: "mid.1",
    confirmation: PHASE5_LOCAL_ROLLBACK_CONFIRMATION,
    reason: "synthetic rollback",
  });
  assert.equal(rollback.reason, "synthetic rollback");
});

test("Phase 5 local renewal validation requires exact identity, owner and caps at six hours", () => {
  assert.throws(
    () => validatePhase5LocalRenewal({
      pilotKey: "phase5-reel-1",
      jobId: "job-new-1",
      sourceMessageId: "mid.1",
      leaseOwner: "worker-1",
      confirmation: "wrong",
    }),
    /confirmation must equal/,
  );
  const renewal = validatePhase5LocalRenewal({
    pilotKey: "phase5-reel-1",
    jobId: "job-new-1",
    sourceMessageId: "mid.1",
    cloudFenceKey: "phase5-reel-1",
    leaseOwner: "phase5-local-worker-1",
    leaseSeconds: 99_999,
    confirmation: PHASE5_LOCAL_RENEW_CONFIRMATION,
    reason: "implementation window",
  });
  assert.equal(renewal.leaseOwner, "phase5-local-worker-1");
  assert.equal(renewal.leaseSeconds, 21_600);
  assert.equal(renewal.reason, "implementation window");
  assert.equal(phase5LeaseRenewalSeconds({ minutes: 1 }), 300);
});

test("Phase 5 guard script is exact-job scoped and secret-free", async () => {
  const script = await readFile(new URL("../scripts/phase5_exact_pilot_guard.py", import.meta.url), "utf8");
  assert.match(script, /PHASE5_ADMIN_TOKEN/);
  assert.match(script, /RENEW EXACT PHASE 5 LOCAL PILOT LEASE/);
  assert.match(script, /ROLL BACK PHASE 5 LOCAL PILOT JOB/);
  assert.match(script, /pilot_key/);
  assert.match(script, /source_message_id/);
  assert.match(script, /lease_owner/);
  assert.match(script, /j\.status/);
  assert.match(script, /publication_artifacts/);
  assert.doesNotMatch(script, /sk-[A-Za-z0-9]/);
  assert.doesNotMatch(script, /Bearer [A-Za-z0-9_\-.]{16,}/);
});

test("Phase 5 one-shot runner requires exact live confirmation and reuses the production processor", async () => {
  const runner = await readFile(new URL("../scripts/phase5_one_job_runner.py", import.meta.url), "utf8");
  assert.match(runner, /RUN EXACT PHASE 5 LOCAL PILOT/);
  assert.match(runner, /verify_cloud/);
  assert.match(runner, /verify_local/);
  assert.match(runner, /status='local_claimed'/);
  assert.match(runner, /status='local_processing'/);
  assert.match(runner, /status='running'/);
  assert.match(runner, /stage='downloading'/);
  assert.match(runner, /processor\.process\(payload\)/);
  assert.match(runner, /result\.pop\("auth_json", None\)/);
  assert.match(runner, /INSTAGRAM_COOKIES_JSON/);
  assert.doesNotMatch(runner, /sk-[A-Za-z0-9]/);
  assert.doesNotMatch(runner, /Bearer [A-Za-z0-9_\-.]{16,}/);
});

test("Phase 5 repository methods use exact one-job lease SQL and auditable events", async () => {
  const client = new FixtureQueryClient();
  const repo = new PostgresReelRepository(client);

  client.enqueue({ rows: [{ pilot_key: "phase5-reel-1", exact_job_id: "job-new-1", status: "armed" }] });
  await repo.createPhase5PilotLease({
    pilotKey: "phase5-reel-1",
    jobId: "job-new-1",
    sourceMessageId: "mid.1",
    cloudFenceKey: "phase5-reel-1",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    audit: { explicit: true },
  });
  client.enqueue({ rows: [{ pilot_key: "phase5-reel-1", exact_job_id: "job-new-1", status: "leased" }] });
  await repo.claimPhase5PilotLease({
    pilotKey: "phase5-reel-1",
    jobId: "job-new-1",
    leaseOwner: "worker-1",
    leaseSeconds: 120,
  });
  client.enqueue({ rows: [{ pilot_key: "phase5-reel-1", exact_job_id: "job-new-1", status: "leased" }] });
  await repo.renewPhase5PilotLease({
    pilotKey: "phase5-reel-1",
    jobId: "job-new-1",
    sourceMessageId: "mid.1",
    leaseOwner: "worker-1",
    leaseSeconds: 21_600,
    reason: "implementation window",
  });
  client.enqueue({ rows: [{ pilot_key: "phase5-reel-1", exact_job_id: "job-new-1", status: "rolled_back" }] });
  await repo.rollbackPhase5PilotLease({
    pilotKey: "phase5-reel-1",
    jobId: "job-new-1",
    reason: "synthetic rollback",
  });

  const sql = client.queries.map((query) => query.text).join("\n");
  assert.match(sql, /INSERT INTO reel_brain\.phase5_pilot_leases/);
  assert.match(sql, /ON CONFLICT \(pilot_key\)/);
  assert.match(sql, /WHERE pilot_key=\$1\s+AND exact_job_id=\$2/);
  assert.match(sql, /INSERT INTO reel_brain\.phase5_pilot_events/);
  assert.match(sql, /status IN \('armed','leased','processing'\)/);
  assert.match(sql, /l\.source_message_id=\$3/);
  assert.match(sql, /j\.status='queued'/);
  assert.match(sql, /NOT EXISTS \(\s+SELECT 1 FROM reel_brain\.artifacts/);
  assert.ok(client.queries.some((query) => query.values?.includes("lease_renewed")), "renewal event must be parameterised into the audit insert");
});

class SyntheticRepo {
  constructor() {
    this.events = [];
    this.artifacts = [];
    this.completedJobs = [];
    this.completedLeases = [];
    this.stages = [];
  }

  async markPhase5PilotProcessing(input) {
    this.processing = input;
    return input;
  }

  async markStage(jobId, stage, status, detail) {
    this.stages.push({ jobId, stage, status, detail });
  }

  async insertPhase5PilotEvent(pilotKey, jobId, stage, status, detail) {
    this.events.push({ pilotKey, jobId, stage, status, detail });
  }

  async recordArtifactWrite(artifact) {
    this.artifacts.push(artifact);
  }

  async completeJob(jobId, output) {
    this.completedJobs.push({ jobId, output });
    return { id: jobId };
  }

  async completePhase5PilotLease(input) {
    this.completedLeases.push(input);
    return input;
  }
}

test("Synthetic Phase 5 pipeline covers media, transcript, schema, tokens, reaction, publication, playback and R2 mirror without network", async () => {
  const root = await mkdtemp(join(tmpdir(), "phase5-synthetic-"));
  const objectStore = new LocalObjectStore(root);
  const repo = new SyntheticRepo();

  const result = await runSyntheticPhase5Pipeline({
    repo,
    objectStore,
    pilotKey: "phase5-reel-1",
    jobId: "job-new-1",
    leaseOwner: "worker-1",
  });

  assert.equal(result.ok, true);
  assert.equal(result.synthetic_only, true);
  assert.deepEqual(result.stages, [...PHASE5_SYNTHETIC_STAGES]);
  assert.equal(result.artifacts.length, 6);
  assert.equal(repo.artifacts.length, 6);
  assert.equal(repo.completedJobs.length, 1);
  assert.equal(repo.completedLeases.length, 1);
  assert.equal(repo.completedJobs[0].output.tokens.total, 1650);
  assert.ok(repo.events.find((event) => event.stage === "reaction" && event.detail.reaction_targeting === "synthetic_only"));
  assert.ok(repo.events.find((event) => event.stage === "r2_mirror"));

  const html = await readFile(join(root, "phase5", "synthetic", "job-new-1", "index.html"), "utf8");
  assert.match(html, /Synthetic Phase 5 local pilot Reel/);
});
