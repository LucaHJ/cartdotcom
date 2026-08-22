import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PostgresReelRepository } from "../src/repositories/postgres-reel-repository.js";

const root = new URL("../", import.meta.url);
const schema = `reel_phase5_test_${process.pid}_${Date.now()}`.toLowerCase();
const sshTarget = process.env.REEL_PHASE2_PG_SSH_TARGET || "cartdotcom-server";
const psqlCommand = "docker exec -i cartdotcom-platform-postgres-1 psql -U cartdotcom -d cartdotcom -v ON_ERROR_STOP=1 -q";

function runPsql(sql, { json = false } = {}) {
  const command = json ? `${psqlCommand} -t -A` : psqlCommand;
  const result = spawnSync("ssh", [sshTarget, command], { input: sql, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
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
    if (this.closed) throw new Error("persistent psql session is closed");
    if (this.pending) throw new Error("persistent psql session only supports one query at a time");
    const json = isRowsQuery(sql);
    const body = json ? `WITH q AS (${stripTrailingSemicolon(sql)}) SELECT COALESCE(json_agg(q),'[]'::json) FROM q;` : `${stripTrailingSemicolon(sql)};`;
    const id = `${process.pid}_${Date.now()}_${++this.counter}`;
    const start = `__REEL_PHASE5_BEGIN_${id}__`;
    const end = `__REEL_PHASE5_END_${id}__`;
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

function migrationSql(name) {
  return readFileSync(new URL(`migrations/${name}`, root), "utf8").replaceAll("reel_brain", schema);
}

async function withRepo(callback) {
  const client = new PersistentSshPsqlClient();
  const repo = new PostgresReelRepository(client, { schema });
  try {
    return await callback(repo);
  } finally {
    await client.close();
  }
}

test.before(() => {
  runPsql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;
${migrationSql("0001_phase1_inert_schema.sql")}
${migrationSql("0002_phase2_local_contracts.sql")}
${migrationSql("0003_phase3_cloud_schema_drift.sql")}
${migrationSql("0004_phase4_shadow_live_mirror.sql")}
${migrationSql("0005_phase5_controlled_pilot.sql")}`);
});

test.after(() => {
  runPsql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
});

test("connected PostgreSQL enforces a single active Phase 5 lease and exact-job rollback", async () => {
  await withRepo(async (repo) => {
    await repo.createJob({ id: "phase5-job-a", sourceUrl: "https://www.instagram.com/reel/PHASE5A/", sourceMessageId: "mid-a" });
    await repo.createJob({ id: "phase5-job-b", sourceUrl: "https://www.instagram.com/reel/PHASE5B/", sourceMessageId: "mid-b" });
    const first = await repo.createPhase5PilotLease({
      pilotKey: "phase5-a",
      jobId: "phase5-job-a",
      sourceMessageId: "mid-a",
      cloudFenceKey: "phase5-a",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    assert.equal(first.pilot_key, "phase5-a");
    const claimed = await repo.claimPhase5PilotLease({ pilotKey: "phase5-a", jobId: "phase5-job-a", leaseOwner: "worker-a" });
    assert.equal(claimed.status, "leased");
    const wrongJob = await repo.claimPhase5PilotLease({ pilotKey: "phase5-a", jobId: "phase5-job-b", leaseOwner: "worker-b" });
    assert.equal(wrongJob, null);
    assert.throws(
      () => runPsql(
        `INSERT INTO ${schema}.phase5_pilot_leases(
          pilot_key,exact_job_id,source_message_id,cloud_fence_key,status,expires_at
        ) VALUES (
          'phase5-b','phase5-job-b','mid-b','phase5-b','armed',now() + interval '10 minutes'
        );`,
      ),
      /phase5_pilot_leases_one_active_idx|duplicate key/i,
    );
    const rolledBack = await repo.rollbackPhase5PilotLease({ pilotKey: "phase5-a", jobId: "phase5-job-a", reason: "connected rollback" });
    assert.equal(rolledBack.status, "rolled_back");
  });

  const summary = JSON.parse(runPsql(
    `SELECT json_agg(t) FROM (
       SELECT
         (SELECT COUNT(*)::int FROM ${schema}.phase5_pilot_leases WHERE status='rolled_back') AS rolled_back,
         (SELECT COUNT(*)::int FROM ${schema}.phase5_pilot_events WHERE stage='rolled_back') AS rollback_events
     ) t;`,
    { json: true },
  ))[0];
  assert.equal(summary.rolled_back, 1);
  assert.equal(summary.rollback_events, 1);
});
