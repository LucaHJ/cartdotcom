import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const tempDir = mkdtempSync(join(tmpdir(), "reel-corrective-"));

function compileTs(sourcePath, outputName) {
  const source = readFileSync(new URL(sourcePath, root), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
  });
  const outputPath = join(tempDir, outputName);
  writeFileSync(outputPath, output.outputText, "utf8");
  return outputPath;
}

const corrective = await import(pathToFileURL(compileTs("src/corrective-resynthesis.ts", "corrective-resynthesis.mjs")).href);

function completeJob(overrides = {}) {
  return {
    id: "job-complete",
    status: "complete",
    stage: "complete",
    instructions: "old instructions",
    pilot_run_id: null,
    source_message_id: "source-message-1",
    ...overrides,
  };
}

class FakeCorrectiveStore {
  constructor(job = completeJob()) {
    this.job = job;
    this.auditMarkers = new Set();
    this.resets = [];
    this.queued = [];
    this.failQueue = false;
    this.queueFailures = [];
  }

  async readJob(jobId) {
    return this.job?.id === jobId ? this.job : null;
  }

  async hasAuditEvent(jobId, marker) {
    return this.auditMarkers.has(`${jobId}:${marker}`);
  }

  async applyReset(reset) {
    if (this.job?.status !== "complete" || this.job?.pilot_run_id) return { applied: false };
    this.resets.push(reset);
    this.job = {
      ...this.job,
      instructions: reset.instructions,
      status: "queued",
      stage: "queued",
    };
    this.auditMarkers.add(`${reset.job.id}:${reset.marker}`);
    return { applied: true };
  }

  async queueJob(jobId) {
    if (this.failQueue) throw new Error("Synthetic queue outage");
    this.queued.push({ jobId });
  }

  async markQueueFailure(jobId, detail) {
    this.queueFailures.push({ jobId, detail });
    if (this.job?.id === jobId && this.job.status === "queued") {
      this.job = {
        ...this.job,
        status: "failed",
        stage: "error_queue",
        error_code: "error_queue",
        error_message: detail,
      };
    }
  }
}

test("corrective primitive requires exact confirmation before mutation or queueing", async () => {
  const store = new FakeCorrectiveStore();
  const result = await corrective.correctivelyResynthesiseOne(store, {
    jobId: "job-complete",
    confirm: "wrong",
    correctiveKey: "key-1",
    instructions: "new instructions",
  });

  assert.equal(result.status, 400);
  assert.equal(store.resets.length, 0);
  assert.equal(store.queued.length, 0);
});

test("corrective primitive accepts only completed non-pilot jobs", async () => {
  const activeStore = new FakeCorrectiveStore(completeJob({ id: "job-active", status: "queued", stage: "queued" }));
  const active = await corrective.correctivelyResynthesiseOne(activeStore, {
    jobId: "job-active",
    confirm: corrective.CORRECTIVE_RESYNTHESIS_CONFIRMATION,
    correctiveKey: "key-active",
    instructions: "new instructions",
  });
  assert.equal(active.status, 409);
  assert.equal(activeStore.resets.length, 0);
  assert.equal(activeStore.queued.length, 0);

  const pilotStore = new FakeCorrectiveStore(completeJob({ id: "job-pilot", pilot_run_id: "pilot-1" }));
  const pilot = await corrective.correctivelyResynthesiseOne(pilotStore, {
    jobId: "job-pilot",
    confirm: corrective.CORRECTIVE_RESYNTHESIS_CONFIRMATION,
    correctiveKey: "key-pilot",
    instructions: "new instructions",
  });
  assert.equal(pilot.status, 409);
  assert.equal(pilotStore.resets.length, 0);
  assert.equal(pilotStore.queued.length, 0);
});

test("corrective primitive applies the exact one-job reset shape and queues exactly once", async () => {
  const store = new FakeCorrectiveStore();
  const result = await corrective.correctivelyResynthesiseOne(store, {
    jobId: "job-complete",
    confirm: corrective.CORRECTIVE_RESYNTHESIS_CONFIRMATION,
    correctiveKey: "quote-correction-1",
    instructions: "Capture only the quote artifact",
    reason: "operator explicit corrective test",
  });

  assert.equal(result.status, 202);
  assert.deepEqual(result.body, {
    ok: true,
    queued: true,
    job_id: "job-complete",
    corrective_key: "quote-correction-1",
  });
  assert.equal(store.resets.length, 1);
  assert.equal(store.queued.length, 1);
  assert.deepEqual(store.queued[0], { jobId: "job-complete" });

  const reset = store.resets[0];
  assert.equal(reset.job.id, "job-complete");
  assert.equal(reset.instructions, "Capture only the quote artifact");
  assert.equal(reset.marker, "corrective-resynthesis:quote-correction-1");
  assert.deepEqual(reset.commandSummary, {
    ok: true,
    corrective_resynthesis: true,
    job_id: "job-complete",
    corrective_key: "quote-correction-1",
    reason: "operator explicit corrective test",
  });

  const audit = JSON.parse(reset.eventDetail);
  assert.equal(audit.marker, "corrective-resynthesis:quote-correction-1");
  assert.equal(audit.reason, "operator explicit corrective test");
  assert.equal(audit.previous_status, "complete");
  assert.equal(audit.previous_stage, "complete");
  assert.equal(audit.previous_instructions, "old instructions");
  assert.equal(audit.next_instructions, "Capture only the quote artifact");
});

test("corrective primitive refuses a lost concurrent claim and queues only the winner", async () => {
  const store = new FakeCorrectiveStore();

  const [first, second] = await Promise.all([
    corrective.correctivelyResynthesiseOne(store, {
      jobId: "job-complete",
      confirm: corrective.CORRECTIVE_RESYNTHESIS_CONFIRMATION,
      correctiveKey: "quote-correction-a",
      instructions: "First corrective instruction",
    }),
    corrective.correctivelyResynthesiseOne(store, {
      jobId: "job-complete",
      confirm: corrective.CORRECTIVE_RESYNTHESIS_CONFIRMATION,
      correctiveKey: "quote-correction-b",
      instructions: "Second corrective instruction",
    }),
  ]);

  assert.deepEqual([first.status, second.status].sort(), [202, 409]);
  assert.equal(store.resets.length, 1);
  assert.equal(store.queued.length, 1);
  assert.equal(store.queued[0].jobId, "job-complete");
});

test("corrective primitive marks queue-send failure as recoverable without false success", async () => {
  const store = new FakeCorrectiveStore();
  store.failQueue = true;

  const result = await corrective.correctivelyResynthesiseOne(store, {
    jobId: "job-complete",
    confirm: corrective.CORRECTIVE_RESYNTHESIS_CONFIRMATION,
    correctiveKey: "quote-correction-queue-failure",
    instructions: "Corrective instruction before queue outage",
  });

  assert.equal(result.status, 502);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.queued, false);
  assert.equal(result.body.recoverable, true);
  assert.equal(store.resets.length, 1, "the corrective audit/reset marker should remain preserved");
  assert.equal(store.queued.length, 0);
  assert.deepEqual(store.queueFailures, [{ jobId: "job-complete", detail: "Synthetic queue outage" }]);
  assert.equal(store.job.status, "failed");
  assert.equal(store.job.stage, "error_queue");
  assert.equal(store.job.error_code, "error_queue");
  assert.equal(store.job.error_message, "Synthetic queue outage");
});

test("corrective primitive refuses repeat calls once the audit marker exists", async () => {
  const store = new FakeCorrectiveStore();
  store.auditMarkers.add("job-complete:corrective-resynthesis:quote-correction-1");

  const result = await corrective.correctivelyResynthesiseOne(store, {
    jobId: "job-complete",
    confirm: corrective.CORRECTIVE_RESYNTHESIS_CONFIRMATION,
    correctiveKey: "quote-correction-1",
    instructions: "Capture only the quote artifact",
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.idempotent, true);
  assert.equal(store.resets.length, 0);
  assert.equal(store.queued.length, 0);
});

test("corrective D1 affected-row helper treats only one changed row as a successful claim", () => {
  assert.equal(corrective.correctiveClaimApplied({ meta: { changes: 1 } }), true);
  assert.equal(corrective.correctiveClaimApplied({ meta: { changes: 0 } }), false);
  assert.equal(corrective.correctiveClaimApplied({ meta: { changes: 2 } }), false);
  assert.equal(corrective.correctiveClaimApplied({}), false);
});

test("corrective admin route remains behind the existing admin gate", () => {
  const source = readFileSync(new URL("src/index.ts", root), "utf8");
  const handleApiIndex = source.indexOf("async function handleApi");
  const adminGateIndex = source.indexOf("const unauthorized = requireAdmin(request, env);", handleApiIndex);
  const correctiveRouteIndex = source.indexOf("const correctiveMatch = url.pathname.match", handleApiIndex);
  const correctiveHandlerIndex = source.indexOf("async function handleCorrectiveResynthesis");
  const claimCheckIndex = source.indexOf("if (!correctiveClaimApplied(claim)) return { applied: false };", correctiveHandlerIndex);
  const destructiveBatchIndex = source.indexOf("DELETE FROM resources", correctiveHandlerIndex);

  assert.ok(adminGateIndex > 0, "admin gate should exist");
  assert.ok(correctiveRouteIndex > adminGateIndex, "corrective route should be registered after requireAdmin");
  assert.ok(claimCheckIndex > correctiveHandlerIndex, "D1 adapter should check the conditional claim result");
  assert.ok(destructiveBatchIndex > claimCheckIndex, "job-owned destructive work should happen only after a won claim");
});
