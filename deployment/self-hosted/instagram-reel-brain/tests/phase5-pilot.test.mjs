import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PHASE5_LOCAL_PILOT_CONFIRMATION,
  PHASE5_LOCAL_ROLLBACK_CONFIRMATION,
  PHASE5_SYNTHETIC_STAGES,
  validatePhase5LeaseRequest,
  validatePhase5LocalRollback,
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
