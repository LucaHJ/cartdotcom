import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { claimJobs, NEW_ARTICLE_PRIORITY, RESYNTHESIS_PRIORITY } from "../common/queue.js";
import { claimRun } from "./scheduler.js";

const password = process.env.PGPASSWORD_FILE
  ? (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim()
  : process.env.PGPASSWORD;
const client = new pg.Client({
  host: process.env.PGHOST || "postgres",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "cartdotcom",
  user: process.env.PGUSER || "cartdotcom",
  password,
});

await client.connect();
try {
  await client.query("BEGIN");
  const suffix = randomUUID();
  const runId = await claimRun(client, new Date(), `source-check-integration-${suffix}`);
  assert.ok(runId, "Scheduler run lease was not acquired");
  const sourceId = `__lease_test_source_${suffix}`;
  await client.query(
    "INSERT INTO sources (id, name, url, category) VALUES ($1, 'Lease test', $2, 'test')",
    [sourceId, `https://invalid.example/${suffix}/feed`],
  );

  for (const [kind, priority] of [["resynthesis", RESYNTHESIS_PRIORITY], ["production", NEW_ARTICLE_PRIORITY]]) {
    const articleId = randomUUID();
    const researchJobId = randomUUID();
    await client.query(
      `INSERT INTO articles
         (id, source_id, title, url, content_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')`,
      [articleId, sourceId, `${kind} lease test`, `https://invalid.example/${suffix}/${kind}`, randomUUID()],
    );
    await client.query(
      "INSERT INTO research_jobs (id, article_id) VALUES ($1, $2)",
      [researchJobId, articleId],
    );
    await client.query(
      `INSERT INTO local_job_queue (id, research_job_id, kind, priority, payload_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [randomUUID(), researchJobId, kind, priority, JSON.stringify({ kind })],
    );
  }

  const claimed = await claimJobs(client, { owner: `integration-check-${suffix}`, limit: 1 });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].kind, "production");
  assert.equal(claimed[0].priority, NEW_ARTICLE_PRIORITY);
  assert.equal(claimed[0].status, "running");
  assert.equal(claimed[0].attempts, 1);
  await client.query("ROLLBACK");
  console.log("Durable queue integration check passed and was rolled back.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
