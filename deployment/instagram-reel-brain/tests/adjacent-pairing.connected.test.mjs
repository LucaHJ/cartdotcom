import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const tempDir = mkdtempSync(join(tmpdir(), "reel-adjacent-"));

function compileTs(sourcePath, outputName, rewrite = (value) => value) {
  const source = rewrite(readFileSync(new URL(sourcePath, root), "utf8"));
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

compileTs("src/domain.ts", "domain.mjs");
const pairingPath = compileTs("src/adjacent-pairing.ts", "adjacent-pairing.mjs", (value) => value.replace('from "./domain"', 'from "./domain.mjs"'));

const domain = await import(pathToFileURL(join(tempDir, "domain.mjs")).href);
const pairing = await import(pathToFileURL(pairingPath).href);

class FakeAdjacentStore {
  constructor() {
    this.now = 100;
    this.pending = [];
    this.commands = new Map();
    this.jobs = new Map();
    this.carousels = new Map();
    this.applied = [];
  }

  addPendingShare(sourceMessageId, createdAt, expiresAt = 200) {
    this.pending.push({ sender_id: "user-1", kind: "share", source_message_id: sourceMessageId, created_at: createdAt, expires_at: expiresAt, consumed: false });
    this.commands.set(sourceMessageId, { source_message_id: sourceMessageId, input_text: "", status: "queued", result_summary: null });
  }

  addPendingInstruction(sourceMessageId, instructions, createdAt, expiresAt = 200) {
    this.pending.push({ sender_id: "user-1", kind: "instruction", source_message_id: sourceMessageId, instructions, created_at: createdAt, expires_at: expiresAt, consumed: false });
    this.commands.set(sourceMessageId, { source_message_id: sourceMessageId, input_text: instructions, status: "waiting_for_share", result_summary: null });
  }

  async takePendingShare(senderId) {
    const match = this.pending
      .filter((row) => row.sender_id === senderId && row.kind === "share" && !row.consumed && row.expires_at >= this.now)
      .sort((a, b) => b.created_at - a.created_at)[0] || null;
    if (match) match.consumed = true;
    return match ? { source_message_id: match.source_message_id } : null;
  }

  async takePendingInstruction(senderId) {
    const match = this.pending
      .filter((row) => row.sender_id === senderId && row.kind === "instruction" && !row.consumed && row.expires_at >= this.now)
      .sort((a, b) => b.created_at - a.created_at)[0] || null;
    if (match) match.consumed = true;
    return match ? { source_message_id: match.source_message_id, instructions: match.instructions } : null;
  }

  async storePendingInstruction(input) {
    this.pending.push({
      sender_id: input.senderId,
      kind: "instruction",
      source_message_id: input.instructionMessageId,
      instructions: input.instructions,
      is_test: false,
      consumed: false,
    });
  }

  async markInstructionWaiting(input) {
    this.commands.set(input.instructionMessageId, {
      source_message_id: input.instructionMessageId,
      status: "waiting_for_share",
      result_summary: input.result,
    });
  }

  async applyPendingInstructionToShare(input) {
    const share = this.commands.get(input.shareMessageId) || { source_message_id: input.shareMessageId };
    share.input_text = input.instructions;
    share.result_summary = input.originalSummary;
    this.commands.set(input.shareMessageId, share);

    const instruction = this.commands.get(input.instructionMessageId) || { source_message_id: input.instructionMessageId };
    instruction.status = "paired";
    instruction.result_summary = input.result;
    instruction.completed = true;
    this.commands.set(input.instructionMessageId, instruction);
  }

  async readTargetState(shareMessageId) {
    return {
      job: this.jobs.get(shareMessageId) || null,
      carousel: this.carousels.get(shareMessageId) || null,
    };
  }

  async applyInstruction(input) {
    this.applied.push(input);
    const share = this.commands.get(input.shareMessageId) || { source_message_id: input.shareMessageId };
    share.input_text = input.instructions;
    share.result_summary = input.originalSummary;
    this.commands.set(input.shareMessageId, share);

    this.commands.set(input.instructionMessageId, {
      source_message_id: input.instructionMessageId,
      status: input.late ? "paired_late" : "paired",
      result_summary: input.result,
      completed: true,
    });

    const job = this.jobs.get(input.shareMessageId);
    if (job?.status === "queued" && job.stage === "queued") job.instructions = input.instructions;
  }
}

test("production helper stores live instruction-before-share candidates as non-test rows", async () => {
  const store = new FakeAdjacentStore();
  const result = await pairing.pairLiveInstructionWithPendingShare(store, {
    senderId: "user-1",
    instructionMessageId: "instruction-before",
    instructions: "Capture the quote only",
  });

  assert.equal(result.paired, false);
  assert.equal(store.pending[0].kind, "instruction");
  assert.equal(store.pending[0].is_test, false);
  assert.equal(store.commands.get("instruction-before").status, "waiting_for_share");
});

test("production helper consumes instruction-before-share and updates both command rows", async () => {
  const store = new FakeAdjacentStore();
  store.addPendingInstruction("instruction-before", "Capture only quote artifacts", 1);
  store.commands.set("share-after", { source_message_id: "share-after", input_text: "", status: "queued", result_summary: null });

  const instructions = await pairing.takePendingInstructionForShare(store, {
    senderId: "user-1",
    shareMessageId: "share-after",
  });

  assert.equal(instructions, "Capture only quote artifacts");
  assert.equal(store.pending.find((row) => row.source_message_id === "instruction-before").consumed, true);
  assert.equal(store.commands.get("instruction-before").status, "paired");
  assert.equal(store.commands.get("share-after").input_text, "Capture only quote artifacts");
  assert.equal(store.commands.get("share-after").result_summary.instruction_source_message_id, "instruction-before");
});

test("production helper pairs share-then-instruction onto the newest queued share and job", async () => {
  const store = new FakeAdjacentStore();
  store.addPendingShare("older-share", 1);
  store.addPendingShare("newest-share", 2);
  store.jobs.set("newest-share", { status: "queued", stage: "queued", instructions: null });

  const result = await pairing.pairLiveInstructionWithPendingShare(store, {
    senderId: "user-1",
    instructionMessageId: "instruction-after",
    instructions: "Research only the mentioned font",
  });

  assert.equal(result.paired, true);
  assert.equal(result.shareMessageId, "newest-share");
  assert.equal(result.late, false);
  assert.equal(store.jobs.get("newest-share").instructions, "Research only the mentioned font");
  assert.equal(store.commands.get("instruction-after").status, "paired");
  assert.equal(store.commands.get("newest-share").input_text, "Research only the mentioned font");
  assert.equal(store.pending.find((row) => row.source_message_id === "older-share").consumed, false);
  assert.equal(store.pending.find((row) => row.source_message_id === "newest-share").consumed, true);
});

test("production helper ignores expired shares and stores a fresh instruction candidate", async () => {
  const store = new FakeAdjacentStore();
  store.addPendingShare("expired-share", 1, 50);

  const result = await pairing.pairLiveInstructionWithPendingShare(store, {
    senderId: "user-1",
    instructionMessageId: "instruction-no-match",
    instructions: "Do not bind to expired shares",
  });

  assert.equal(result.paired, false);
  assert.equal(store.pending.find((row) => row.source_message_id === "expired-share").consumed, false);
  assert.equal(store.commands.get("instruction-no-match").status, "waiting_for_share");
});

test("production helper marks running jobs as late with corrective action", async () => {
  const store = new FakeAdjacentStore();
  store.addPendingShare("running-share", 1);
  store.jobs.set("running-share", { status: "running", stage: "synthesizing", instructions: null });

  const result = await pairing.pairLiveInstructionWithPendingShare(store, {
    senderId: "user-1",
    instructionMessageId: "late-instruction",
    instructions: "This arrived late",
  });

  assert.equal(result.paired, true);
  assert.equal(result.late, true);
  assert.equal(result.result.corrective_action, "explicit_resynthesis_required");
  assert.equal(store.commands.get("late-instruction").status, "paired_late");
});

test("production decision helpers protect recognized commands, duplicates, and unauthorized senders", () => {
  assert.equal(domain.shouldStoreLiveInstructionCandidate({
    mode: "live",
    hasShare: false,
    emptyMessage: false,
    commandIntent: "note",
  }), false);
  assert.equal(domain.shouldStoreLiveInstructionCandidate({
    mode: "live",
    hasShare: false,
    emptyMessage: false,
    commandIntent: "unknown",
  }), true);
  assert.equal(domain.instagramWebhookSkipReason({ senderAllowed: false, duplicateCommand: false }), "sender_not_allowed");
  assert.equal(domain.instagramWebhookSkipReason({ senderAllowed: true, duplicateCommand: true }), "duplicate_command");
});

test("production decision helpers preserve queue grace and test-only audit semantics", () => {
  assert.equal(domain.queueDelaySecondsForAdjacentInstruction("live"), 12);
  assert.equal(domain.queueDelaySecondsForAdjacentInstruction("test_only"), 0);
  assert.equal(domain.pendingPartIsTest({ mode: "test_only", kind: "instruction" }), true);
  assert.equal(domain.pendingPartIsTest({ mode: "live", kind: "instruction" }), false);
  assert.equal(domain.shouldCreateLiveInstructionTarget({ mode: "live", hasShare: true, instructions: "" }), true);
  assert.equal(domain.shouldCreateLiveInstructionTarget({ mode: "live", hasShare: true, instructions: "same bubble" }), false);
});

test("production queue helper sends live Reel and carousel messages with the grace delay", async () => {
  const calls = [];
  const queue = {
    async send(message, options) {
      calls.push({ message, options });
    },
  };

  await pairing.sendQueueMessageWithAdjacentInstructionDelay(queue, { jobId: "job-1" }, "live");
  await pairing.sendQueueMessageWithAdjacentInstructionDelay(queue, { type: "carousel_resolve", sourceMessageId: "carousel-mid" }, "live");
  await pairing.sendQueueMessageWithAdjacentInstructionDelay(queue, { jobId: "test-job" }, "test_only");

  assert.deepEqual(calls[0], { message: { jobId: "job-1" }, options: { delaySeconds: 12 } });
  assert.deepEqual(calls[1], { message: { type: "carousel_resolve", sourceMessageId: "carousel-mid" }, options: { delaySeconds: 12 } });
  assert.deepEqual(calls[2], { message: { jobId: "test-job" }, options: undefined });
});
