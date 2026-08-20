import assert from "node:assert/strict";
import test from "node:test";
import { FixtureQueryClient } from "../src/repositories/fixture-client.js";
import { PostgresReelRepository, RepositoryConflictError } from "../src/repositories/postgres-reel-repository.js";

function defer() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class BlockingFixtureClient extends FixtureQueryClient {
  constructor({ blockPattern, failPattern, failAfterBlock = false } = {}) {
    super();
    this.blockPattern = blockPattern;
    this.failPattern = failPattern;
    this.failAfterBlock = failAfterBlock;
    this.blocked = defer();
    this.releaseBlock = defer();
    this.failed = false;
  }

  async query(text, values = []) {
    const queryText = String(text);
    if (this.blockPattern?.test(queryText)) {
      this.queries.push({ text: queryText, values });
      this.blocked.resolve();
      await this.releaseBlock.promise;
      if (this.failAfterBlock) throw new Error("synthetic blocked query failure");
      return { rows: [], rowCount: 0 };
    }
    if (!this.failed && this.failPattern?.test(queryText)) {
      this.failed = true;
      this.queries.push({ text: queryText, values });
      throw new Error("synthetic query failure");
    }
    return super.query(text, values);
  }
}

test("PostgreSQL repository inserts jobs only with pre-Codex dedupe keys", async () => {
  const client = new FixtureQueryClient();
  client.enqueue({ rows: [{ id: "job-1", dedupe_key: "instagram:ABC123" }] });
  const repo = new PostgresReelRepository(client);

  const job = await repo.createJob({
    id: "job-1",
    sourceUrl: "https://www.instagram.com/reel/ABC123/",
  });

  assert.equal(job.id, "job-1");
  assert.match(client.queries[0].text, /ON CONFLICT \(dedupe_key\) WHERE status <> 'duplicate'/);
  assert.equal(client.queries[0].values[4], "instagram:ABC123");

  await assert.rejects(() => repo.createJob({ id: "bad", sourceUrl: "https://example.com/not-instagram" }), RepositoryConflictError);
});

test("PostgreSQL repository claims one queued non-pilot job with row locking", async () => {
  const client = new FixtureQueryClient();
  client.enqueue({ rows: [{ id: "job-1", status: "running", worker_id: "worker-a" }] });
  const repo = new PostgresReelRepository(client);

  const claimed = await repo.claimNextQueuedJob("worker-a");

  assert.equal(claimed.id, "job-1");
  assert.match(client.queries[0].text, /FOR UPDATE SKIP LOCKED/);
  assert.match(client.queries[0].text, /pilot_run_id IS NULL/);
  assert.equal(client.queries[0].values[0], "worker-a");
});

test("Repository stage, completion, failure, and resource methods produce auditable mutations", async () => {
  const client = new FixtureQueryClient();
  const repo = new PostgresReelRepository(client);

  client.enqueue({ rows: [{ id: "job-1" }] });
  await repo.markStage("job-1", "downloading", "running", "fixture stage");
  client.enqueue({ rows: [{ id: "job-1" }] });
  await repo.completeJob("job-1", {
    processingSeconds: 12.5,
    tokens: { input: 10, cachedInput: 2, output: 3, reasoningOutput: 1, total: 13 },
    htmlKey: "library/reels/a.html",
    libraryPath: "reels/a/index.html",
    synthesisJsonKey: "synthesis/a.json",
    detail: "done",
  });
  client.enqueue({ rows: [{ id: "job-2" }] });
  await repo.failJob("job-2", "error_fixture", "synthetic failure");
  client.enqueue({ rows: [{ id: "resource-1" }] });
  await repo.upsertResource({
    id: "resource-1",
    jobId: "job-1",
    name: "Watering your own grass",
    slug: "watering-your-own-grass",
    artifactType: "quote",
    canonicalKey: "quote:watering-your-own-grass",
    libraryPath: "quotes/watering-your-own-grass.html",
  });
  await repo.recordArtifactWrite({ jobId: "job-1", key: "frames/1.jpg", checksum: "abc", byteLength: 3, contentType: "image/jpeg" });

  const sql = client.queries.map((query) => query.text).join("\n");
  assert.match(sql, /INSERT INTO reel_brain\.job_events/);
  assert.match(sql, /status='complete'/);
  assert.match(sql, /status='failed'/);
  assert.match(sql, /ON CONFLICT \(job_id, slug\)/);
  assert.match(sql, /ON CONFLICT \(job_id, object_key\)/);
});

test("Repository validates schema names and does not append terminal events on lost guarded updates", async () => {
  const client = new FixtureQueryClient();
  assert.throws(() => new PostgresReelRepository(client, { schema: "bad;drop" }), /Invalid schema name/);
  const repo = new PostgresReelRepository(client);

  const complete = await repo.completeJob("missing", {});
  const failed = await repo.failJob("missing", "error_missing", "missing");

  assert.equal(complete, null);
  assert.equal(failed, null);
  assert.equal(client.queries.filter((query) => /INSERT INTO reel_brain\.job_events/.test(query.text)).length, 0);
});

test("Repository transaction rolls back interrupted fixture work", async () => {
  const client = new FixtureQueryClient();
  const repo = new PostgresReelRepository(client);

  await assert.rejects(
    () => repo.withTransaction(async () => {
      await repo.markStage("job-1", "synthesising", "running", "before interrupt");
      throw new Error("synthetic interruption");
    }),
    /synthetic interruption/,
  );

  assert.equal(client.queries[0].text, "BEGIN");
  assert.equal(client.queries.at(-1).text, "ROLLBACK");
});

test("Repository genuine nested calls share one transaction context", async () => {
  const client = new FixtureQueryClient();
  const repo = new PostgresReelRepository(client);
  client.enqueue({ rows: [{ id: "job-1" }] });
  client.enqueue({ rows: [{ id: "job-1" }] });

  await repo.withTransaction(async () => {
    await repo.markStage("job-1", "downloading", "running", "nested stage");
    await repo.completeJob("job-1", { detail: "nested complete" });
  });

  assert.equal(client.queries.filter((query) => query.text === "BEGIN").length, 1);
  assert.equal(client.queries.filter((query) => query.text === "COMMIT").length, 1);
  assert.equal(client.queries.filter((query) => query.text === "ROLLBACK").length, 0);
});

test("Repository serializes unrelated concurrent top-level transitions on one client", async () => {
  const client = new BlockingFixtureClient({ blockPattern: /INSERT INTO reel_brain\.job_events/ });
  const repo = new PostgresReelRepository(client);
  client.enqueue({ rows: [{ id: "job-a" }] });
  client.enqueue({ rows: [{ id: "job-b" }] });

  const first = repo.markStage("job-a", "downloading", "running", "first");
  await client.blocked.promise;
  const second = repo.markStage("job-b", "downloading", "running", "second");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(client.queries.filter((query) => query.text === "BEGIN").length, 1);
  assert.equal(client.queries.some((query) => query.values?.[0] === "job-b"), false);

  client.releaseBlock.resolve();
  await Promise.all([first, second]);

  const beginIndexes = client.queries.flatMap((query, index) => query.text === "BEGIN" ? [index] : []);
  const commitIndexes = client.queries.flatMap((query, index) => query.text === "COMMIT" ? [index] : []);
  assert.equal(beginIndexes.length, 2);
  assert.equal(commitIndexes.length, 2);
  assert.ok(commitIndexes[0] < beginIndexes[1]);
});

test("Repository releases transaction state after failure and success", async () => {
  const client = new BlockingFixtureClient({ failPattern: /INSERT INTO reel_brain\.job_events/ });
  const repo = new PostgresReelRepository(client);
  client.enqueue({ rows: [{ id: "job-fail" }] });
  client.enqueue({ rows: [{ id: "job-ok" }] });

  await assert.rejects(() => repo.markStage("job-fail", "downloading", "running", "fail"), /synthetic query failure/);
  await repo.markStage("job-ok", "downloading", "running", "ok");

  assert.equal(client.queries.filter((query) => query.text === "BEGIN").length, 2);
  assert.equal(client.queries.filter((query) => query.text === "ROLLBACK").length, 1);
  assert.equal(client.queries.filter((query) => query.text === "COMMIT").length, 1);
  assert.ok(client.queries.find((query) => query.values?.[0] === "job-ok"));
});

test("Repository standalone SQL waits for an unrelated rollback and then survives independently", async () => {
  const client = new BlockingFixtureClient({
    blockPattern: /INSERT INTO reel_brain\.job_events/,
    failAfterBlock: true,
  });
  const repo = new PostgresReelRepository(client);
  client.enqueue({ rows: [{ id: "job-txn" }] });
  client.enqueue({ rows: [{ id: "job-standalone" }] });
  client.enqueue({ rows: [{ id: "resource-standalone" }] });

  const failing = repo.markStage("job-txn", "downloading", "running", "must rollback");
  await client.blocked.promise;
  const created = repo.createJob({ id: "job-standalone", sourceUrl: "https://www.instagram.com/reel/STANDALONE1/" });
  const resource = repo.upsertResource({
    id: "resource-standalone",
    jobId: "job-standalone",
    name: "Standalone Resource",
    slug: "standalone-resource",
  });
  const artifact = repo.recordArtifactWrite({
    jobId: "job-standalone",
    key: "standalone/metadata.json",
    checksum: "abc123",
    byteLength: 12,
    contentType: "application/json",
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(client.queries.some((query) => query.values?.includes("job-standalone")), false);
  assert.equal(client.queries.some((query) => query.values?.includes("resource-standalone")), false);

  client.releaseBlock.resolve();
  const results = await Promise.allSettled([failing, created, resource, artifact]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  assert.equal(results[2].status, "fulfilled");
  assert.equal(results[3].status, "fulfilled");

  const rollbackIndex = client.queries.findIndex((query) => query.text === "ROLLBACK");
  const createIndex = client.queries.findIndex((query) => query.values?.includes("job-standalone"));
  const resourceIndex = client.queries.findIndex((query) => query.values?.includes("resource-standalone"));
  const artifactIndex = client.queries.findIndex((query) => query.values?.includes("standalone/metadata.json"));
  assert.ok(rollbackIndex > -1);
  assert.ok(createIndex > rollbackIndex);
  assert.ok(resourceIndex > createIndex);
  assert.ok(artifactIndex > resourceIndex);
});
