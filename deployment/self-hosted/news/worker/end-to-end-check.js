import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { NEW_ARTICLE_PRIORITY } from "../common/queue.js";

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
const suffix = randomUUID();
const sourceId = `__worker_test_source_${suffix}`;
const articleId = `__worker_test_article_${suffix}`;
const jobId = `__worker_test_job_${suffix}`;
const queueId = `__worker_test_queue_${suffix}`;
const publishedAt = "2026-08-19T00:00:00.000Z";

await client.connect();
try {
  await client.query(
    "INSERT INTO sources (id, name, url, category) VALUES ($1, 'Worker integration test', $2, 'test')",
    [sourceId, `https://invalid.example/${suffix}/feed`],
  );
  await client.query(
    `INSERT INTO articles
       (id, source_id, title, url, summary, published_at, discovered_at,
        content_hash, status, content_plaintext, content_source, content_status)
     VALUES ($1, $2, 'Synthetic NVIDIA product announcement', $3,
       'NVIDIA announces a new data-center GPU for this isolated pipeline test.',
       $4, CURRENT_TIMESTAMP, $5, 'queued',
       'NVIDIA announces a new data-center GPU. This is synthetic test content.',
       'test', 'stored')`,
    [articleId, sourceId, `https://invalid.example/${suffix}/article`, publishedAt, randomUUID()],
  );
  await client.query(
    "INSERT INTO research_jobs (id, article_id, prediction_delay_eligible) VALUES ($1, $2, 0)",
    [jobId, articleId],
  );
  await client.query(
    `INSERT INTO local_job_queue
       (id, research_job_id, kind, priority, status, payload_json)
     VALUES ($1, $2, 'integration-test', $3, 'pending', $4::jsonb)`,
    [queueId, jobId, NEW_ARTICLE_PRIORITY, JSON.stringify({ jobId, articleId })],
  );

  const deadline = Date.now() + 360000;
  let queue;
  while (Date.now() < deadline) {
    const result = await client.query(
      "SELECT status, attempts, last_error FROM local_job_queue WHERE id = $1",
      [queueId],
    );
    queue = result.rows[0];
    if (["succeeded", "failed"].includes(queue?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(queue?.status, "succeeded", queue?.last_error || "Worker integration check timed out.");
  const result = await client.query(
    `SELECT outcomes.symbol, outcomes.direction, outcomes.prediction_at,
            jobs.prediction_delay_seconds, results.id AS result_id
     FROM research_jobs AS jobs
     INNER JOIN research_results AS results ON results.job_id = jobs.id
     INNER JOIN prediction_outcomes AS outcomes ON outcomes.result_id = results.id
     WHERE jobs.id = $1 AND outcomes.symbol = 'NVDA'`,
    [jobId],
  );
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0].direction, "bullish");
  assert.equal(new Date(result.rows[0].prediction_at).toISOString(), publishedAt);
  assert.equal(result.rows[0].prediction_delay_seconds, null);
  console.log(JSON.stringify({
    ok: true,
    queue_status: queue.status,
    attempts: queue.attempts,
    symbol: result.rows[0].symbol,
    direction: result.rows[0].direction,
    prediction_at: new Date(result.rows[0].prediction_at).toISOString(),
  }));
} finally {
  await client.query("BEGIN");
  try {
    await client.query("DELETE FROM article_corpus_objects WHERE article_id = $1", [articleId]);
    await client.query("DELETE FROM prediction_outcomes WHERE article_id = $1", [articleId]);
    await client.query("DELETE FROM research_results WHERE article_id = $1", [articleId]);
    await client.query("DELETE FROM local_job_queue WHERE research_job_id = $1", [jobId]);
    await client.query("DELETE FROM research_jobs WHERE id = $1", [jobId]);
    await client.query("DELETE FROM articles WHERE id = $1", [articleId]);
    await client.query("DELETE FROM sources WHERE id = $1", [sourceId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
