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

class SshPsqlClient {
  async query(text, values = []) {
    const sql = parameterize(text, values);
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql)) {
      runPsql(sql);
      return { rows: [], rowCount: 0 };
    }
    if (!/\bRETURNING\b/i.test(sql) && !/^\s*(SELECT|WITH)\b/i.test(sql)) {
      runPsql(sql);
      return { rows: [], rowCount: 0 };
    }
    const rowsText = runPsql(`WITH q AS (${sql}) SELECT COALESCE(json_agg(q),'[]'::json) FROM q;`, { json: true });
    const rows = JSON.parse(rowsText || "[]");
    return { rows, rowCount: rows.length };
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
  const repo = new PostgresReelRepository(new SshPsqlClient(), { schema });
  const first = await repo.createJob({ id: "pg-job-1", sourceUrl: "https://www.instagram.com/reel/PG001/" });
  const duplicate = await repo.createJob({ id: "pg-job-dup", sourceUrl: "https://www.instagram.com/reel/PG001/" });

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

  const repo = new PostgresReelRepository(new SshPsqlClient(), { schema });
  const claimed = await repo.claimNextQueuedJob("worker-connected");
  assert.equal(claimed.id, "pg-lock-2");
  await new Promise((resolve, reject) => {
    locker.on("exit", (code) => code === 0 ? resolve() : reject(new Error("locker failed")));
  });
});

test("connected PostgreSQL terminal updates append events only when guarded update changes a row", async () => {
  const repo = new PostgresReelRepository(new SshPsqlClient(), { schema });
  await repo.createJob({ id: "pg-complete-1", sourceUrl: "https://www.instagram.com/reel/COMPLETE1/" });
  await repo.completeJob("pg-complete-1", { detail: "complete once" });
  const second = await repo.completeJob("pg-complete-1", { detail: "complete twice" });
  const missingFail = await repo.failJob("missing-job", "error_missing", "missing");

  assert.equal(second, null);
  assert.equal(missingFail, null);
  const rows = JSON.parse(runPsql(`SELECT json_agg(t) FROM (SELECT stage,status,detail FROM ${schema}.job_events WHERE job_id='pg-complete-1' ORDER BY id) t;`, { json: true }));
  assert.equal(rows.filter((row) => row.stage === "complete").length, 1);
});

test("connected PostgreSQL transaction rollback leaves no interrupted event", () => {
  runPsql(`
    INSERT INTO ${schema}.jobs(id,source_url,dedupe_key,status,stage)
    VALUES ('pg-rollback-1','https://www.instagram.com/reel/ROLLBACK1/','instagram:ROLLBACK1','queued','queued');
    BEGIN;
    UPDATE ${schema}.jobs SET status='running', stage='downloading' WHERE id='pg-rollback-1';
    INSERT INTO ${schema}.job_events(job_id,stage,status,detail) VALUES ('pg-rollback-1','downloading','running','inside rollback');
    ROLLBACK;
  `);
  const rows = JSON.parse(runPsql(`SELECT json_agg(t) FROM (SELECT COUNT(*)::int AS count FROM ${schema}.job_events WHERE job_id='pg-rollback-1') t;`, { json: true }));
  assert.equal(rows[0].count, 0);
});

test("connected PostgreSQL resource/artifact writes are idempotent", async () => {
  const repo = new PostgresReelRepository(new SshPsqlClient(), { schema });
  await repo.createJob({ id: "pg-artifact-1", sourceUrl: "https://www.instagram.com/reel/ARTIFACT1/" });
  const resource = {
    id: "pg-resource-1", jobId: "pg-artifact-1", name: "Synthetic Quote", slug: "synthetic-quote",
    artifactType: "quote", canonicalKey: "quote:synthetic-quote", summary: "one",
  };
  await repo.upsertResource(resource);
  await repo.upsertResource({ ...resource, summary: "two" });
  await repo.recordArtifactWrite({ jobId: "pg-artifact-1", key: "metadata.json", checksum: "a", byteLength: 1 });
  await repo.recordArtifactWrite({ jobId: "pg-artifact-1", key: "metadata.json", checksum: "b", byteLength: 2 });
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
  const repo = new PostgresReelRepository(new SshPsqlClient(), { schema });
  const storageRoot = await mkdtemp(join(tmpdir(), "reel-scrubbed-import-"));
  const objectStore = new LocalObjectStore(storageRoot);
  const exportData = JSON.parse(readFileSync(new URL("fixtures/synthetic/scrubbed-d1-export.json", root), "utf8"));

  const result = await importScrubbedD1Export({ repository: repo, objectStore, exportData });
  assert.deepEqual(result, { jobs: 1, resources: 1, artifacts: 1 });

  const rows = JSON.parse(runPsql(`SELECT json_agg(t) FROM (
    SELECT
      (SELECT COUNT(*)::int FROM ${schema}.jobs WHERE id='synthetic-job-1') AS jobs,
      (SELECT COUNT(*)::int FROM ${schema}.resources WHERE id='synthetic-resource-1') AS resources,
      (SELECT COUNT(*)::int FROM ${schema}.artifacts WHERE job_id='synthetic-job-1') AS artifacts
  ) t;`, { json: true }))[0];
  assert.deepEqual(rows, { jobs: 1, resources: 1, artifacts: 1 });
});
