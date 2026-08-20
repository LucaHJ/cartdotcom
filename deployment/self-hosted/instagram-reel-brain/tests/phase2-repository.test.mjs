import assert from "node:assert/strict";
import test from "node:test";
import { FixtureQueryClient } from "../src/repositories/fixture-client.js";
import { PostgresReelRepository, RepositoryConflictError } from "../src/repositories/postgres-reel-repository.js";

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
