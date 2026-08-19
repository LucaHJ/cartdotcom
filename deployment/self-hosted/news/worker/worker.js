import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import { claimJobs, extendLease, releaseForRetry } from "../common/queue.js";
import { normalizeResult, researchPrompt } from "./prompt.js";

const { Pool } = pg;
const SERVICE_NAME = "news-worker";
const INSTANCE_ID = process.env.INSTANCE_ID || process.env.HOSTNAME || randomUUID();
const STARTED_AT = new Date();
const WORKERS_ENABLED = /^(1|true|yes)$/i.test(process.env.WORKERS_ENABLED || "false");
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.WORKER_CONCURRENCY || 8)));
const LEASE_SECONDS = Math.max(600, Number(process.env.WORKER_LEASE_SECONDS || 900));
const JOB_TIMEOUT_MS = Math.max(60000, Number(process.env.CODEX_JOB_TIMEOUT_MS || 330000));
const RUNNER_URL = process.env.CODEX_RUNNER_URL || "http://codex-runner:3010/research";
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 3002);

const runtime = {
  enabled: WORKERS_ENABLED,
  status: "starting",
  concurrency: CONCURRENCY,
  active: 0,
  completed: 0,
  failed: 0,
  lastError: null,
};

async function databaseConfig() {
  const password = process.env.PGPASSWORD_FILE
    ? (await readFile(process.env.PGPASSWORD_FILE, "utf8")).trim()
    : process.env.PGPASSWORD;
  return {
    host: process.env.PGHOST || "postgres",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "cartdotcom",
    user: process.env.PGUSER || "cartdotcom",
    password,
    max: CONCURRENCY + 4,
  };
}

async function heartbeat(pool) {
  await pool.query(
    `INSERT INTO service_heartbeats
       (service_name, instance_id, started_at, heartbeat_at, status, detail_json)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5::jsonb)
     ON CONFLICT (service_name) DO UPDATE SET
       instance_id = EXCLUDED.instance_id, started_at = EXCLUDED.started_at,
       heartbeat_at = EXCLUDED.heartbeat_at, status = EXCLUDED.status,
       detail_json = EXCLUDED.detail_json`,
    [SERVICE_NAME, INSTANCE_ID, STARTED_AT, runtime.status, JSON.stringify(runtime)],
  );
}

async function runCodex(prompt) {
  const response = await fetch(RUNNER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(payload.error || `Codex runner failed with HTTP ${response.status}`);
  }
  return payload.result;
}

async function loadJob(pool, researchJobId) {
  const result = await pool.query(
    `SELECT jobs.id AS job_id, jobs.prediction_delay_eligible,
            articles.*, sources.name AS source_name, sources.source_type, sources.weight AS source_weight
     FROM research_jobs AS jobs
     INNER JOIN articles ON articles.id = jobs.article_id
     LEFT JOIN sources ON sources.id = articles.source_id
     WHERE jobs.id = $1`,
    [researchJobId],
  );
  return result.rows[0] || null;
}

async function markStarted(pool, queueJob) {
  await pool.query(
    `UPDATE research_jobs
     SET status = 'running', attempts = $2, started_at = CURRENT_TIMESTAMP,
         finished_at = NULL, last_error = NULL
     WHERE id = $1`,
    [queueJob.research_job_id, queueJob.attempts],
  );
}

async function storeSuccess(pool, queueJob, article, fields, durationSeconds) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lease = await client.query(
      `SELECT id FROM local_job_queue
       WHERE id = $1 AND status = 'running' AND lease_owner = $2
       FOR UPDATE`,
      [queueJob.id, INSTANCE_ID],
    );
    if (lease.rowCount !== 1) throw new Error("Worker lease was lost before completion.");

    const resultId = randomUUID();
    const memo = JSON.stringify({
      event_title: fields.event_title,
      event_type: fields.event_type,
      event_blurb: fields.event_blurb,
      impact_details: fields.impact_details,
      companies: fields.companies,
      industries: fields.industries,
      symbols: fields.symbols,
      sentiment_score: fields.sentiment_score,
      impact_horizon: fields.impact_horizon,
      confidence: fields.confidence,
      summary: fields.summary,
      memo: fields.memo,
    });
    const stored = await client.query(
      `INSERT INTO research_results
         (id, job_id, article_id, event_type, companies, industries, symbols,
          sentiment_score, impact_horizon, confidence, summary, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (job_id) DO UPDATE SET
         event_type = EXCLUDED.event_type, companies = EXCLUDED.companies,
         industries = EXCLUDED.industries, symbols = EXCLUDED.symbols,
         sentiment_score = EXCLUDED.sentiment_score,
         impact_horizon = EXCLUDED.impact_horizon, confidence = EXCLUDED.confidence,
         summary = EXCLUDED.summary, memo = EXCLUDED.memo,
         created_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [resultId, queueJob.research_job_id, article.id, fields.event_type,
        JSON.stringify(fields.companies), JSON.stringify(fields.industries), JSON.stringify(fields.symbols),
        fields.sentiment_score, fields.impact_horizon, fields.confidence,
        fields.event_blurb || fields.summary, memo],
    );
    const storedResultId = stored.rows[0].id;
    await client.query("DELETE FROM prediction_outcomes WHERE result_id = $1", [storedResultId]);
    const predictionAt = article.published_at || article.discovered_at;
    for (const call of fields.calls) {
      await client.query(
        `INSERT INTO prediction_outcomes
           (id, result_id, article_id, article_title, article_url, symbol, company,
            direction, score, confidence, rationale, prediction_at,
            baseline_price, baseline_at, intervals_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, NULL, '{}')
         ON CONFLICT (result_id, symbol) DO UPDATE SET
           company = EXCLUDED.company, direction = EXCLUDED.direction,
           score = EXCLUDED.score, confidence = EXCLUDED.confidence,
           rationale = EXCLUDED.rationale, prediction_at = EXCLUDED.prediction_at,
           updated_at = CURRENT_TIMESTAMP`,
        [randomUUID(), storedResultId, article.id, article.title, article.url, call.symbol,
          call.name || null, call.direction, fields.sentiment_score, call.confidence ?? fields.confidence,
          call.reason, predictionAt],
      );
    }
    await client.query(
      `UPDATE research_jobs
       SET status = 'succeeded', last_error = NULL, finished_at = CURRENT_TIMESTAMP,
           synthesis_duration_seconds = $2,
           prediction_delay_seconds = CASE
             WHEN prediction_delay_eligible = 1 AND (SELECT published_at FROM articles WHERE id = research_jobs.article_id) IS NOT NULL
             THEN GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - (SELECT published_at FROM articles WHERE id = research_jobs.article_id)))::integer)
             ELSE NULL END,
           research_slot = NULL
       WHERE id = $1`,
      [queueJob.research_job_id, durationSeconds],
    );
    await client.query(
      "UPDATE articles SET status = $2 WHERE id = $1",
      [article.id, fields.symbols.length ? "analyzed" : "archived"],
    );
    await client.query(
      `INSERT INTO article_corpus_objects (article_id, storage_status, updated_at)
       VALUES ($1, 'pending', CURRENT_TIMESTAMP)
       ON CONFLICT (article_id) DO UPDATE SET
         storage_status = CASE WHEN article_corpus_objects.storage_status = 'stored'
           THEN article_corpus_objects.storage_status ELSE 'pending' END,
         updated_at = CURRENT_TIMESTAMP`,
      [article.id],
    );
    await client.query(
      `UPDATE local_job_queue
       SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
           finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, last_error = NULL
       WHERE id = $1`,
      [queueJob.id],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function storeFailure(pool, queueJob, article, error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = await releaseForRetry(pool, {
    id: queueJob.id,
    owner: INSTANCE_ID,
    error: message,
    attempts: queueJob.attempts,
  });
  await pool.query(
    `UPDATE research_jobs
     SET status = $2, attempts = $3, last_error = $4,
         finished_at = CASE WHEN $2 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END,
         synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL,
         research_slot = NULL
     WHERE id = $1`,
    [queueJob.research_job_id, status || "pending", queueJob.attempts, message.slice(0, 1000)],
  );
  if (status === "failed" && article) {
    await pool.query("UPDATE articles SET status = 'archived' WHERE id = $1", [article.id]);
  }
}

async function processJob(pool, queueJob) {
  runtime.active += 1;
  runtime.status = "working";
  let article;
  const startedAt = Date.now();
  const leaseTimer = setInterval(() => {
    extendLease(pool, { id: queueJob.id, owner: INSTANCE_ID, leaseSeconds: LEASE_SECONDS })
      .catch((error) => console.error("Failed to extend worker lease", error));
  }, 60000);
  try {
    await markStarted(pool, queueJob);
    article = await loadJob(pool, queueJob.research_job_id);
    if (!article) throw new Error("Article not found for research job.");
    const fields = normalizeResult(await runCodex(researchPrompt(article)));
    await storeSuccess(pool, queueJob, article, fields, Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
    runtime.completed += 1;
    runtime.lastError = null;
  } catch (error) {
    runtime.failed += 1;
    runtime.lastError = error instanceof Error ? error.message : String(error);
    await storeFailure(pool, queueJob, article, error).catch((storeError) => {
      console.error("Failed to persist research failure", storeError);
    });
    console.error(`Research job ${queueJob.research_job_id} failed`, error);
  } finally {
    clearInterval(leaseTimer);
    runtime.active -= 1;
    runtime.status = runtime.active ? "working" : "idle";
    await heartbeat(pool).catch(() => {});
  }
}

function startHealthServer() {
  return createServer((request, response) => {
    if (request.url !== "/healthz") return response.writeHead(404).end("not found");
    const healthy = !["starting", "degraded"].includes(runtime.status);
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify(runtime));
  }).listen(HEALTH_PORT, "0.0.0.0");
}

async function main() {
  const pool = new Pool(await databaseConfig());
  startHealthServer();
  if (WORKERS_ENABLED) {
    runtime.status = "idle";
  } else {
    runtime.status = "disabled";
  }
  await heartbeat(pool);
  const heartbeatTimer = setInterval(() => heartbeat(pool).catch(() => {}), 30000);
  const pollTimer = setInterval(async () => {
    if (!WORKERS_ENABLED || runtime.active >= CONCURRENCY) return;
    try {
      const jobs = await claimJobs(pool, {
        owner: INSTANCE_ID,
        limit: CONCURRENCY - runtime.active,
        leaseSeconds: LEASE_SECONDS,
      });
      for (const job of jobs) void processJob(pool, job);
    } catch (error) {
      runtime.status = "degraded";
      runtime.lastError = error instanceof Error ? error.message : String(error);
      console.error("Worker polling failed", error);
    }
  }, 2000);

  const shutdown = async () => {
    clearInterval(heartbeatTimer);
    clearInterval(pollTimer);
    runtime.status = "stopping";
    await heartbeat(pool).catch(() => {});
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  console.log(JSON.stringify({ event: "worker_started", instanceId: INSTANCE_ID, ...runtime }));
}

main().catch((error) => {
  console.error("Worker failed to start", error);
  process.exit(1);
});
