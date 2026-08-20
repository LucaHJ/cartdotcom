import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PostgresReelRepository } from "../src/repositories/postgres-reel-repository.js";
import { LocalObjectStore } from "../src/storage/local-object-store.js";
import { importScrubbedD1Export } from "../src/repositories/scrubbed-importer.js";

const root = new URL("../", import.meta.url);
const schema = `reel_phase2_test_${process.pid}_${Date.now()}`.toLowerCase();
const sshTarget = process.env.REEL_PHASE2_PG_SSH_TARGET || "cartdotcom-server";
const psqlCommand = "docker exec -i cartdotcom-platform-postgres-1 psql -U cartdotcom -d cartdotcom -v ON_ERROR_STOP=1 -q";

function runPsql(sql, { json = false } = {}) {
  const command = json
    ? `${psqlCommand} -t -A`
    : psqlCommand;
  const result = spawnSync("ssh", [sshTarget, command], { input: sql, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parameterize(text, values) {
  return text.replace(/\$(\d+)/g, (_match, index) => sqlLiteral(values[Number(index) - 1]));
}

function defer() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function stripTrailingSemicolon(sql) {
  return sql.trim().replace(/;\s*$/, "");
}

function isRowsQuery(sql) {
  return /\bRETURNING\b/i.test(sql) || /^\s*(SELECT|WITH)\b/i.test(sql);
}

class PersistentSshPsqlClient {
  constructor() {
    this.child = spawn("ssh", [sshTarget, `${psqlCommand} -X -t -A`], { stdio: ["pipe", "pipe", "pipe"] });
    this.stdout = "";
    this.stderr = "";
    this.counter = 0;
    this.pending = null;
    this.closed = false;
    this.queries = [];
    this.child.stdout.on("data", (chunk) => {
      this.stdout += chunk.toString("utf8");
      this.resolvePending();
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8");
    });
    this.child.on("exit", (code) => {
      this.closed = true;
      if (this.pending) {
        this.pending.reject(new Error(`persistent psql exited with ${code}: ${this.stderr}`));
        this.pending = null;
      }
    });
  }

  resolvePending() {
    if (!this.pending) return;
    const start = this.stdout.indexOf(this.pending.start);
    if (start === -1) return;
    const end = this.stdout.indexOf(this.pending.end, start + this.pending.start.length);
    if (end === -1) return;
    const output = this.stdout.slice(start + this.pending.start.length, end).trim();
    this.stdout = this.stdout.slice(end + this.pending.end.length);
    const pending = this.pending;
    this.pending = null;
    try {
      const rows = pending.json ? JSON.parse(output || "[]") : [];
      pending.resolve({ rows, rowCount: rows.length });
    } catch (error) {
      pending.reject(error);
    }
  }

  async query(text, values = []) {
    const sql = parameterize(text, values);
    this.queries.push({ text: String(text), values, sql });
    if (this.closed) throw new Error("persistent psql session is closed");
    if (this.pending) throw new Error("persistent psql session only supports one query at a time");
    const json = isRowsQuery(sql);
    const body = json
      ? `WITH q AS (${stripTrailingSemicolon(sql)}) SELECT COALESCE(json_agg(q),'[]'::json) FROM q;`
      : `${stripTrailingSemicolon(sql)};`;
    const id = `${process.pid}_${Date.now()}_${++this.counter}`;
    const start = `__REEL_PHASE2_BEGIN_${id}__`;
    const end = `__REEL_PHASE2_END_${id}__`;
    return new Promise((resolve, reject) => {
      this.pending = { start, end, json, resolve, reject };
      this.child.stdin.write(`\\echo ${start}\n${body}\n\\echo ${end}\n`);
    });
  }

  async close() {
    if (this.closed) return;
    await new Promise((resolve) => {
      this.child.once("exit", resolve);
      this.child.stdin.end("\\q\n");
    });
  }
}

class InterruptingClient {
  constructor(inner, pattern, { holdBeforeThrow = false } = {}) {
    this.inner = inner;
    this.pattern = pattern;
    this.holdBeforeThrow = holdBeforeThrow;
    this.interrupted = false;
    this.reachedInterrupt = defer();
    this.releaseInterrupt = defer();
  }

  async query(text, values = []) {
    if (!this.interrupted && this.pattern.test(String(text))) {
      this.interrupted = true;
      this.reachedInterrupt.resolve();
      if (this.holdBeforeThrow) await this.releaseInterrupt.promise;
      throw new Error("synthetic interruption between state update and event insert");
    }
    return this.inner.query(text, values);
  }

  async close() {
    return this.inner.close();
  }
}

async function withConnectedRepo(callback, client = new PersistentSshPsqlClient()) {
  const repo = new PostgresReelRepository(client, { schema });
  try {
    return await callback(repo, client);
  } finally {
    await client.close();
  }
}

function migrationSql(name) {
  return readFileSync(new URL(`migrations/${name}`, root), "utf8").replaceAll("reel_brain", schema);
}

async function setupSchema() {
  runPsql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;\n${migrationSql("0001_phase1_inert_schema.sql")}\n${migrationSql("0002_phase2_local_contracts.sql")}`);
}

async function dropSchema() {
  runPsql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
}

test.before(setupSchema);
test.after(dropSchema);

test("connected PostgreSQL enforces partial unique dedupe and duplicate-idempotent insert", async () => {
  const { first, duplicate } = await withConnectedRepo(async (repo) => ({
    first: await repo.createJob({ id: "pg-job-1", sourceUrl: "https://www.instagram.com/reel/PG001/" }),
    duplicate: await repo.createJob({ id: "pg-job-dup", sourceUrl: "https://www.instagram.com/reel/PG001/" }),
  }));

  assert.equal(first.id, "pg-job-1");
  assert.equal(duplicate, null);
  runPsql(`INSERT INTO ${schema}.jobs(id,source_url,dedupe_key,status,stage) VALUES ('pg-job-dupe-row','https://www.instagram.com/reel/PG001/','instagram:PG001','duplicate','duplicate');`);
  const count = JSON.parse(runPsql(`SELECT json_agg(t) FROM (SELECT COUNT(*)::int AS count FROM ${schema}.jobs WHERE dedupe_key='instagram:PG001') t;`, { json: true }))[0].count;
  assert.equal(count, 2);
});

test("connected PostgreSQL SKIP LOCKED claim skips a concurrently locked queued job", async () => {
  runPsql(`UPDATE ${schema}.jobs SET status='failed', stage='test_isolated' WHERE status='queued';`);
  runPsql(`
    INSERT INTO ${schema}.jobs(id,source_url,dedupe_key,status,stage,created_at)
    VALUES
      ('pg-lock-1','https://www.instagram.com/reel/LOCK1/','instagram:LOCK1','queued','queued', now() - interval '10 seconds'),
      ('pg-lock-2','https://www.instagram.com/reel/LOCK2/','instagram:LOCK2','queued','queued', now());
  `);
  const locker = spawn("ssh", [sshTarget, psqlCommand], { stdio: ["pipe", "ignore", "pipe"] });
  locker.stdin.end(`BEGIN; SELECT id FROM ${schema}.jobs WHERE id='pg-lock-1' FOR UPDATE; SELECT pg_sleep(4); COMMIT;`);
  await new Promise((resolve) => setTimeout(resolve, 700));

  const claimed = await withConnectedRepo((repo) => repo.claimNextQueuedJob("worker-connected"));
  assert.equal(claimed.id, "pg-lock-2");
  await new Promise((resolve, reject) => {
    locker.on("exit", (code) => code === 0 ? resolve() : reject(new Error("locker failed")));
  });
});

test("connected PostgreSQL terminal updates append events only when guarded update changes a row", async () => {
  const { second, missingFail } = await withConnectedRepo(async (repo) => {
    await repo.createJob({ id: "pg-complete-1", sourceUrl: "https://www.instagram.com/reel/COMPLETE1/" });
    await repo.markStage("pg-complete-1", "downloading", "running", "download started");
    await repo.completeJob("pg-complete-1", { detail: "complete once" });
    return {
      second: await repo.completeJob("pg-complete-1", { detail: "complete twice" }),
      missingFail: await repo.failJob("missing-job", "error_missing", "missing"),
    };
  });

  assert.equal(second, null);
  assert.equal(missingFail, null);
  const rows = JSON.parse(runPsql(`SELECT json_agg(t) FROM (SELECT stage,status,detail FROM ${schema}.job_events WHERE job_id='pg-complete-1' ORDER BY id) t;`, { json: true }));
  assert.equal(rows.filter((row) => row.stage === "downloading").length, 1);
  assert.equal(rows.filter((row) => row.stage === "complete").length, 1);
});

test("connected PostgreSQL repository withTransaction rollback uses one persistent session", async () => {
  runPsql(`
    INSERT INTO ${schema}.jobs(id,source_url,dedupe_key,status,stage)
    VALUES ('pg-rollback-1','https://www.instagram.com/reel/ROLLBACK1/','instagram:ROLLBACK1','queued','queued');
  `);
  await assert.rejects(
    () => withConnectedRepo((repo) => repo.withTransaction(async () => {
      await repo.markStage("pg-rollback-1", "downloading", "running", "inside rollback");
      throw new Error("synthetic rollback");
    })),
    /synthetic rollback/,
  );
  const rows = JSON.parse(runPsql(`SELECT json_agg(t) FROM (
    SELECT status, stage, (SELECT COUNT(*)::int FROM ${schema}.job_events WHERE job_id='pg-rollback-1') AS events
    FROM ${schema}.jobs WHERE id='pg-rollback-1'
  ) t;`, { json: true }))[0];
  assert.deepEqual(rows, { status: "queued", stage: "queued", events: 0 });
});

test("connected PostgreSQL public transition rolls back when interrupted between update and event", async () => {
  runPsql(`
    INSERT INTO ${schema}.jobs(id,source_url,dedupe_key,status,stage)
    VALUES ('pg-interrupt-1','https://www.instagram.com/reel/INTERRUPT1/','instagram:INTERRUPT1','queued','queued');
  `);
  const persistent = new PersistentSshPsqlClient();
  const interrupting = new InterruptingClient(persistent, new RegExp(`INSERT INTO ${schema}\\.job_events`));

  await assert.rejects(
    () => withConnectedRepo((repo) => repo.markStage("pg-interrupt-1", "downloading", "running", "interrupted"), interrupting),
    /synthetic interruption/,
  );

  const rows = JSON.parse(runPsql(`SELECT json_agg(t) FROM (
    SELECT status, stage, (SELECT COUNT(*)::int FROM ${schema}.job_events WHERE job_id='pg-interrupt-1') AS events
    FROM ${schema}.jobs WHERE id='pg-interrupt-1'
  ) t;`, { json: true }))[0];
  assert.deepEqual(rows, { status: "queued", stage: "queued", events: 0 });
});

test("connected PostgreSQL nested transitions share one transaction and release state", async () => {
  runPsql(`
    INSERT INTO ${schema}.jobs(id,source_url,dedupe_key,status,stage)
    VALUES ('pg-nested-1','https://www.instagram.com/reel/NESTED1/','instagram:NESTED1','queued','queued');
  `);
  const client = new PersistentSshPsqlClient();
  await withConnectedRepo(async (repo) => {
    await repo.withTransaction(async () => {
      await repo.markStage("pg-nested-1", "downloading", "running", "nested stage");
      await repo.completeJob("pg-nested-1", { detail: "nested complete" });
    });
    await repo.failJob("missing-after-nested", "error_missing", "missing");
  }, client);

  assert.equal(client.queries.filter((query) => query.text === "BEGIN").length, 2);
  assert.equal(client.queries.filter((query) => query.text === "COMMIT").length, 2);
  const firstCommit = client.queries.findIndex((query) => query.text === "COMMIT");
  const secondBegin = client.queries.findIndex((query, index) => index > firstCommit && query.text === "BEGIN");
  assert.ok(secondBegin > firstCommit);

  const rows = JSON.parse(runPsql(`SELECT json_agg(t) FROM (
    SELECT status, stage, (SELECT COUNT(*)::int FROM ${schema}.job_events WHERE job_id='pg-nested-1') AS events
    FROM ${schema}.jobs WHERE id='pg-nested-1'
  ) t;`, { json: true }))[0];
  assert.deepEqual(rows, { status: "complete", stage: "complete", events: 2 });
});

test("connected PostgreSQL unrelated concurrent transitions do not share a transaction", async () => {
  runPsql(`
    INSERT INTO ${schema}.jobs(id,source_url,dedupe_key,status,stage)
    VALUES
      ('pg-concurrent-a','https://www.instagram.com/reel/CONCURRENTA/','instagram:CONCURRENTA','queued','queued'),
      ('pg-concurrent-b','https://www.instagram.com/reel/CONCURRENTB/','instagram:CONCURRENTB','queued','queued');
  `);
  const persistent = new PersistentSshPsqlClient();
  const interrupting = new InterruptingClient(
    persistent,
    new RegExp(`INSERT INTO ${schema}\\.job_events`),
    { holdBeforeThrow: true },
  );
  const repo = new PostgresReelRepository(interrupting, { schema });

  const failing = repo.markStage("pg-concurrent-a", "downloading", "running", "must rollback");
  await interrupting.reachedInterrupt.promise;
  const succeeding = repo.markStage("pg-concurrent-b", "downloading", "running", "must commit");
  await new Promise((resolve) => setTimeout(resolve, 50));

  const queriesBeforeRelease = persistent.queries.map((query) => query.text);
  assert.equal(queriesBeforeRelease.filter((text) => text === "BEGIN").length, 1);
  assert.equal(persistent.queries.some((query) => query.values?.[0] === "pg-concurrent-b"), false);

  interrupting.releaseInterrupt.resolve();
  const results = await Promise.allSettled([failing, succeeding]);
  await interrupting.close();
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");

  const beginIndexes = persistent.queries.flatMap((query, index) => query.text === "BEGIN" ? [index] : []);
  const rollbackIndex = persistent.queries.findIndex((query) => query.text === "ROLLBACK");
  const commitIndex = persistent.queries.findIndex((query) => query.text === "COMMIT");
  assert.equal(beginIndexes.length, 2);
  assert.ok(rollbackIndex > beginIndexes[0]);
  assert.ok(beginIndexes[1] > rollbackIndex);
  assert.ok(commitIndex > beginIndexes[1]);

  const rows = JSON.parse(runPsql(`SELECT json_agg(t ORDER BY id) FROM (
    SELECT id, status, stage, (SELECT COUNT(*)::int FROM ${schema}.job_events e WHERE e.job_id=jobs.id) AS events
    FROM ${schema}.jobs WHERE id IN ('pg-concurrent-a','pg-concurrent-b')
  ) t;`, { json: true }));
  assert.deepEqual(rows, [
    { id: "pg-concurrent-a", status: "queued", stage: "queued", events: 0 },
    { id: "pg-concurrent-b", status: "running", stage: "downloading", events: 1 },
  ]);
});

test("connected PostgreSQL standalone create/resource/artifact waits for unrelated rollback and survives", async () => {
  runPsql(`
    INSERT INTO ${schema}.jobs(id,source_url,dedupe_key,status,stage)
    VALUES ('pg-standalone-txn','https://www.instagram.com/reel/STANDALONETXN/','instagram:STANDALONETXN','queued','queued');
  `);
  const persistent = new PersistentSshPsqlClient();
  const interrupting = new InterruptingClient(
    persistent,
    new RegExp(`INSERT INTO ${schema}\\.job_events`),
    { holdBeforeThrow: true },
  );
  const repo = new PostgresReelRepository(interrupting, { schema });

  const failing = repo.markStage("pg-standalone-txn", "downloading", "running", "must rollback");
  await interrupting.reachedInterrupt.promise;
  const created = repo.createJob({ id: "pg-standalone-job", sourceUrl: "https://www.instagram.com/reel/STANDALONEJOB/" });
  const resource = repo.upsertResource({
    id: "pg-standalone-resource",
    jobId: "pg-standalone-job",
    name: "Standalone Resource",
    slug: "standalone-resource",
  });
  const artifact = repo.recordArtifactWrite({
    jobId: "pg-standalone-job",
    key: "standalone/metadata.json",
    checksum: "abc123",
    byteLength: 12,
    contentType: "application/json",
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(persistent.queries.some((query) => query.values?.includes("pg-standalone-job")), false);
  assert.equal(persistent.queries.some((query) => query.values?.includes("pg-standalone-resource")), false);

  interrupting.releaseInterrupt.resolve();
  const results = await Promise.allSettled([failing, created, resource, artifact]);
  await interrupting.close();
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  assert.equal(results[2].status, "fulfilled");
  assert.equal(results[3].status, "fulfilled");

  const rollbackIndex = persistent.queries.findIndex((query) => query.text === "ROLLBACK");
  const createIndex = persistent.queries.findIndex((query) => query.values?.includes("pg-standalone-job"));
  const resourceIndex = persistent.queries.findIndex((query) => query.values?.includes("pg-standalone-resource"));
  const artifactIndex = persistent.queries.findIndex((query) => query.values?.includes("standalone/metadata.json"));
  assert.ok(rollbackIndex > -1);
  assert.ok(createIndex > rollbackIndex);
  assert.ok(resourceIndex > createIndex);
  assert.ok(artifactIndex > resourceIndex);

  const rows = JSON.parse(runPsql(`SELECT json_agg(t ORDER BY kind) FROM (
    SELECT 'artifact' AS kind, COUNT(*)::int AS count FROM ${schema}.artifacts WHERE job_id='pg-standalone-job'
    UNION ALL
    SELECT 'resource' AS kind, COUNT(*)::int AS count FROM ${schema}.resources WHERE job_id='pg-standalone-job'
    UNION ALL
    SELECT 'standalone_job' AS kind, COUNT(*)::int AS count FROM ${schema}.jobs WHERE id='pg-standalone-job'
    UNION ALL
    SELECT 'transaction_job_events' AS kind, COUNT(*)::int AS count FROM ${schema}.job_events WHERE job_id='pg-standalone-txn'
    UNION ALL
    SELECT 'transaction_job_running' AS kind, COUNT(*)::int AS count FROM ${schema}.jobs WHERE id='pg-standalone-txn' AND status='running'
  ) t;`, { json: true }));
  assert.deepEqual(rows, [
    { kind: "artifact", count: 1 },
    { kind: "resource", count: 1 },
    { kind: "standalone_job", count: 1 },
    { kind: "transaction_job_events", count: 0 },
    { kind: "transaction_job_running", count: 0 },
  ]);
});

test("connected PostgreSQL resource/artifact writes are idempotent", async () => {
  await withConnectedRepo(async (repo) => {
    await repo.createJob({ id: "pg-artifact-1", sourceUrl: "https://www.instagram.com/reel/ARTIFACT1/" });
    const resource = {
      id: "pg-resource-1", jobId: "pg-artifact-1", name: "Synthetic Quote", slug: "synthetic-quote",
      artifactType: "quote", canonicalKey: "quote:synthetic-quote", summary: "one",
    };
    await repo.upsertResource(resource);
    await repo.upsertResource({ ...resource, summary: "two" });
    await repo.recordArtifactWrite({ jobId: "pg-artifact-1", key: "metadata.json", checksum: "a", byteLength: 1 });
    await repo.recordArtifactWrite({ jobId: "pg-artifact-1", key: "metadata.json", checksum: "b", byteLength: 2 });
  });
  const rows = JSON.parse(runPsql(`SELECT json_agg(t) FROM (
    SELECT
      (SELECT COUNT(*)::int FROM ${schema}.resources WHERE job_id='pg-artifact-1') AS resources,
      (SELECT summary FROM ${schema}.resources WHERE id='pg-resource-1') AS summary,
      (SELECT COUNT(*)::int FROM ${schema}.artifacts WHERE job_id='pg-artifact-1') AS artifacts,
      (SELECT checksum_sha256 FROM ${schema}.artifacts WHERE job_id='pg-artifact-1') AS checksum
  ) t;`, { json: true }))[0];
  assert.deepEqual(rows, { resources: 1, summary: "two", artifacts: 1, checksum: "b" });
});

test("connected PostgreSQL enforces carousel and pending-part constraints", () => {
  assert.throws(() => runPsql(`INSERT INTO ${schema}.pending_dm_parts(id,sender_id,source_message_id,kind,expires_at) VALUES ('bad','s','m','bad_kind',now());`), /psql failed/);
  assert.throws(() => runPsql(`INSERT INTO ${schema}.instagram_carousel_resolutions(id,source_message_id,status) VALUES ('bad','m','waiting');`), /psql failed/);
});

test("connected PostgreSQL imports a scrubbed D1-shaped export into isolated schema and test storage", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "reel-scrubbed-import-"));
  const objectStore = new LocalObjectStore(storageRoot);
  const exportData = JSON.parse(readFileSync(new URL("fixtures/synthetic/scrubbed-d1-export.json", root), "utf8"));

  const result = await withConnectedRepo((repo) => importScrubbedD1Export({ repository: repo, objectStore, exportData }));
  assert.deepEqual(result, { jobs: 1, resources: 1, artifacts: 1 });

  const rows = JSON.parse(runPsql(`SELECT json_agg(t) FROM (
    SELECT
      (SELECT COUNT(*)::int FROM ${schema}.jobs WHERE id='synthetic-job-1') AS jobs,
      (SELECT COUNT(*)::int FROM ${schema}.resources WHERE id='synthetic-resource-1') AS resources,
      (SELECT COUNT(*)::int FROM ${schema}.artifacts WHERE job_id='synthetic-job-1') AS artifacts
  ) t;`, { json: true }))[0];
  assert.deepEqual(rows, { jobs: 1, resources: 1, artifacts: 1 });
});
