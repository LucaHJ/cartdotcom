import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import { fetchSource, hashText, mapWithConcurrency } from "./feed.js";
import { NEW_ARTICLE_PRIORITY } from "../common/queue.js";
import { floorToInterval, millisecondsUntilNextBoundary } from "./time.js";

const { Pool } = pg;
const SERVICE_NAME = "news-scheduler";
const INTERVAL_MS = Number(process.env.SOURCE_CHECK_INTERVAL_MS || 300000);
const FETCH_CONCURRENCY = Number(process.env.SOURCE_FETCH_CONCURRENCY || 12);
const INGESTION_ENABLED = /^(1|true|yes)$/i.test(process.env.INGESTION_ENABLED || "false");
const INSTANCE_ID = process.env.INSTANCE_ID || process.env.HOSTNAME || randomUUID();
const STARTED_AT = new Date();
const RUN_LEASE_SECONDS = Math.max(600, Number(process.env.SCHEDULER_LEASE_SECONDS || 900));
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 3001);

const runtime = {
  enabled: INGESTION_ENABLED,
  leader: false,
  status: "starting",
  lastRunAt: null,
  lastSuccessAt: null,
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
    max: 6,
  };
}

function uniqueByUrl(items) {
  return [...new Map(items.map((item) => [item.url, item])).values()];
}

async function heartbeat(pool, status = runtime.status) {
  await pool.query(
    `INSERT INTO service_heartbeats
       (service_name, instance_id, started_at, heartbeat_at, status, detail_json)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5::jsonb)
     ON CONFLICT (service_name) DO UPDATE SET
       instance_id = EXCLUDED.instance_id,
       started_at = EXCLUDED.started_at,
       heartbeat_at = EXCLUDED.heartbeat_at,
       status = EXCLUDED.status,
       detail_json = EXCLUDED.detail_json`,
    [SERVICE_NAME, INSTANCE_ID, STARTED_AT, status, JSON.stringify(runtime)],
  );
}

async function claimRun(pool, scheduledFor) {
  const id = randomUUID();
  const result = await pool.query(
    `INSERT INTO scheduler_runs
       (id, task_name, scheduled_for, status, lease_owner, lease_expires_at, started_at)
     VALUES ($1, 'source-check', $2, 'running', $3,
       CURRENT_TIMESTAMP + ($4 * interval '1 second'), CURRENT_TIMESTAMP)
     ON CONFLICT (task_name, scheduled_for) DO UPDATE SET
       status = 'running',
       lease_owner = EXCLUDED.lease_owner,
       lease_expires_at = EXCLUDED.lease_expires_at,
       started_at = CURRENT_TIMESTAMP,
       completed_at = NULL,
       error = NULL
     WHERE scheduler_runs.status = 'failed'
        OR (scheduler_runs.status = 'running' AND scheduler_runs.lease_expires_at < CURRENT_TIMESTAMP)
     RETURNING id`,
    [id, scheduledFor, INSTANCE_ID, RUN_LEASE_SECONDS],
  );
  return result.rows[0]?.id || null;
}

async function markRunFailed(pool, runId, error) {
  await pool.query(
    `UPDATE scheduler_runs
     SET status = 'failed', completed_at = CURRENT_TIMESTAMP, lease_owner = NULL,
         lease_expires_at = NULL, error = $2
     WHERE id = $1 AND status = 'running'`,
    [runId, String(error).slice(0, 4000)],
  );
}

async function recordObservations(client, fetched, checkId, checkedAtIso) {
  const states = await client.query(
    "SELECT source_id, initialized_at, last_feed_hash FROM feed_source_state",
  );
  const stateBySource = new Map(states.rows.map((row) => [row.source_id, row]));

  for (const result of fetched) {
    const existingState = stateBySource.get(result.source);
    if (result.error) {
      if (existingState) {
        await client.query(
          `UPDATE feed_source_state
           SET last_checked_at = $1, last_error = $2
           WHERE source_id = $3`,
          [checkedAtIso, result.error.slice(0, 1000), result.source],
        );
      }
      continue;
    }

    const initialized = Boolean(existingState);
    const initializedAt = existingState?.initialized_at || checkedAtIso;
    const initializedEpoch = Date.parse(initializedAt);
    const uniqueItems = uniqueByUrl(result.items);
    const feedHash = hashText(uniqueItems.map((item) => item.url).sort().join("\n"));
    const changedItems = initialized && existingState?.last_feed_hash === feedHash ? [] : uniqueItems;

    for (const item of changedItems) {
      const publishedEpoch = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN;
      const disposition = Number.isFinite(publishedEpoch)
        ? (publishedEpoch >= initializedEpoch ? "pending" : (initialized ? "stale" : "baseline"))
        : (initialized ? "pending" : "baseline");
      const articleId = hashText(item.url);
      await client.query(
        `INSERT INTO feed_item_ledger
           (id, source_id, url, article_id, title, summary, content_plaintext,
            published_at, first_seen_at, first_check_id, disposition, acquired_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           CASE WHEN EXISTS (SELECT 1 FROM articles WHERE id = $4 OR url = $3)
             THEN 'duplicate' ELSE $11 END,
           CASE WHEN EXISTS (SELECT 1 FROM articles WHERE id = $4 OR url = $3)
             THEN CURRENT_TIMESTAMP ELSE NULL END)
         ON CONFLICT (source_id, url) DO NOTHING`,
        [
          hashText(`${item.source.id}\n${item.url}`), item.source.id, item.url, articleId,
          item.title, disposition === "baseline" ? null : item.summary,
          disposition === "baseline" ? null : item.contentPlaintext, item.publishedAt,
          checkedAtIso, checkId, disposition,
        ],
      );
    }

    await client.query(
      `INSERT INTO feed_source_state
         (source_id, initialized_at, last_checked_at, last_success_at,
          last_item_count, last_feed_hash, last_error)
       VALUES ($1, $2, $2, $2, $3, $4, NULL)
       ON CONFLICT (source_id) DO UPDATE SET
         last_checked_at = EXCLUDED.last_checked_at,
         last_success_at = EXCLUDED.last_success_at,
         last_item_count = EXCLUDED.last_item_count,
         last_feed_hash = EXCLUDED.last_feed_hash,
         last_error = NULL`,
      [result.source, checkedAtIso, uniqueItems.length, feedHash],
    );
  }
}

async function acquirePendingItems(client, checkedAtIso) {
  const pending = await client.query(
    `SELECT ledger.id AS ledger_id, ledger.source_id, ledger.url, ledger.title,
            ledger.summary, ledger.content_plaintext, ledger.published_at
     FROM feed_item_ledger AS ledger
     INNER JOIN sources ON sources.id = ledger.source_id
     WHERE ledger.disposition = 'pending' AND sources.enabled = 1
     ORDER BY ledger.first_seen_at, ledger.id`,
  );
  let inserted = 0;

  for (const item of pending.rows) {
    const articleId = hashText(item.url);
    const contentHash = hashText(`${item.title}\n${item.summary || ""}`);
    const article = await client.query(
      `INSERT INTO articles
         (id, source_id, title, url, summary, published_at, discovered_at,
          content_hash, content_plaintext, content_source, content_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
         CASE WHEN $9::text IS NULL THEN NULL ELSE 'feed' END, 'pending')
       ON CONFLICT (url) DO NOTHING
       RETURNING id`,
      [articleId, item.source_id, item.title, item.url, item.summary, item.published_at,
        checkedAtIso, contentHash, item.content_plaintext],
    );

    if (article.rowCount === 0) {
      await client.query(
        `UPDATE articles
         SET published_at = COALESCE(published_at, $1),
             summary = COALESCE(summary, $2),
             content_plaintext = COALESCE(content_plaintext, $3),
             content_source = CASE WHEN content_plaintext IS NULL AND $3::text IS NOT NULL
               THEN 'feed' ELSE content_source END
         WHERE url = $4`,
        [item.published_at, item.summary, item.content_plaintext, item.url],
      );
      await client.query(
        `UPDATE feed_item_ledger
         SET disposition = 'duplicate', acquired_at = COALESCE(acquired_at, CURRENT_TIMESTAMP), last_error = NULL
         WHERE id = $1`,
        [item.ledger_id],
      );
      continue;
    }

    const jobId = randomUUID();
    const researchJob = await client.query(
      `INSERT INTO research_jobs (id, article_id, status, prediction_delay_eligible)
       VALUES ($1, $2, 'pending', 1)
       ON CONFLICT (article_id) DO NOTHING
       RETURNING id`,
      [jobId, articleId],
    );
    if (researchJob.rowCount === 1) {
      await client.query(
        `INSERT INTO local_job_queue
           (id, research_job_id, kind, priority, status, payload_json)
         VALUES ($1, $2, 'production', $3, 'pending', $4::jsonb)
         ON CONFLICT (research_job_id) DO NOTHING`,
        [randomUUID(), jobId, NEW_ARTICLE_PRIORITY, JSON.stringify({ jobId, articleId })],
      );
    }
    await client.query(
      `UPDATE feed_item_ledger
       SET disposition = 'acquired', acquired_at = COALESCE(acquired_at, CURRENT_TIMESTAMP), last_error = NULL
       WHERE id = $1`,
      [item.ledger_id],
    );
    inserted += 1;
  }
  return inserted;
}

async function recordCheckDetails(client, checkId, fetched) {
  for (const result of fetched) {
    await client.query(
      `INSERT INTO source_check_details
         (check_id, source_id, fetched_item_count, new_item_count, acquired_count,
          duplicate_count, baseline_count, stale_count, pending_count, error)
       SELECT $1, $2, $3, COUNT(*),
         COUNT(*) FILTER (WHERE disposition = 'acquired'),
         COUNT(*) FILTER (WHERE disposition = 'duplicate'),
         COUNT(*) FILTER (WHERE disposition = 'baseline'),
         COUNT(*) FILTER (WHERE disposition = 'stale'),
         COUNT(*) FILTER (WHERE disposition = 'pending'), $4
       FROM feed_item_ledger
       WHERE first_check_id = $1 AND source_id = $2
       ON CONFLICT (check_id, source_id) DO UPDATE SET
         fetched_item_count = EXCLUDED.fetched_item_count,
         new_item_count = EXCLUDED.new_item_count,
         acquired_count = EXCLUDED.acquired_count,
         duplicate_count = EXCLUDED.duplicate_count,
         baseline_count = EXCLUDED.baseline_count,
         stale_count = EXCLUDED.stale_count,
         pending_count = EXCLUDED.pending_count,
         error = EXCLUDED.error`,
      [checkId, result.source, result.count, result.error || null],
    );
  }
}

async function persistSourceCheck(pool, { runId, scheduledFor, fetched, startedAt }) {
  const client = await pool.connect();
  const checkId = randomUUID();
  const checkedAtIso = scheduledFor.toISOString();
  try {
    await client.query("BEGIN");
    await recordObservations(client, fetched, checkId, checkedAtIso);
    const inserted = await acquirePendingItems(client, checkedAtIso);
    await recordCheckDetails(client, checkId, fetched);
    const completedAt = new Date();
    const durationSeconds = Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000));
    const failedSourceCount = fetched.filter((result) => result.error).length;
    await client.query(
      `INSERT INTO source_checks
         (id, checked_at, completed_at, duration_seconds, acquired_count, source_count, failed_source_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [checkId, checkedAtIso, completedAt, durationSeconds, inserted, fetched.length, failedSourceCount],
    );
    const hourStart = new Date(floorToInterval(scheduledFor.getTime(), 3600000));
    await client.query(
      `INSERT INTO source_hourly_metrics (hour_start, article_count, ticker_count, updated_at)
       VALUES ($1, $2, 0, CURRENT_TIMESTAMP)
       ON CONFLICT (hour_start) DO UPDATE SET
         article_count = source_hourly_metrics.article_count + EXCLUDED.article_count,
         updated_at = CURRENT_TIMESTAMP`,
      [hourStart, inserted],
    );
    const result = {
      check_id: checkId,
      acquired_count: inserted,
      source_count: fetched.length,
      failed_source_count: failedSourceCount,
      duration_seconds: durationSeconds,
    };
    await client.query(
      `UPDATE scheduler_runs
       SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP, lease_owner = NULL,
           lease_expires_at = NULL, result_json = $2::jsonb, error = NULL
       WHERE id = $1`,
      [runId, JSON.stringify(result)],
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runSourceCheck(pool, scheduledFor) {
  const runId = await claimRun(pool, scheduledFor);
  if (!runId) return null;
  const startedAt = new Date();
  runtime.status = "checking";
  runtime.lastRunAt = startedAt.toISOString();
  await heartbeat(pool);
  try {
    const sources = await pool.query(
      `SELECT id, name, url, category, weight, source_type AS "sourceType"
       FROM sources WHERE enabled = 1 ORDER BY id`,
    );
    const fetched = await mapWithConcurrency(sources.rows, FETCH_CONCURRENCY, (source) => fetchSource(source));
    const result = await persistSourceCheck(pool, { runId, scheduledFor, fetched, startedAt });
    runtime.status = "idle";
    runtime.lastSuccessAt = new Date().toISOString();
    runtime.lastError = null;
    await heartbeat(pool);
    console.log(JSON.stringify({ event: "source_check_completed", scheduledFor, ...result }));
    return result;
  } catch (error) {
    runtime.status = "degraded";
    runtime.lastError = error instanceof Error ? error.message : String(error);
    await markRunFailed(pool, runId, runtime.lastError).catch(() => {});
    await heartbeat(pool).catch(() => {});
    console.error("Source check failed", error);
    return null;
  }
}

function startHealthServer() {
  return createServer((request, response) => {
    if (request.url !== "/healthz") {
      response.writeHead(404).end("not found");
      return;
    }
    const healthy = runtime.status !== "starting" && runtime.status !== "degraded";
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify(runtime));
  }).listen(HEALTH_PORT, "0.0.0.0");
}

async function main() {
  const pool = new Pool(await databaseConfig());
  const leaderClient = await pool.connect();
  const lock = await leaderClient.query("SELECT pg_try_advisory_lock(68421937) AS acquired");
  runtime.leader = Boolean(lock.rows[0]?.acquired);
  runtime.status = runtime.leader ? (INGESTION_ENABLED ? "idle" : "disabled") : "standby";
  startHealthServer();

  await pool.query(
    `UPDATE scheduler_runs
     SET status = 'failed', completed_at = CURRENT_TIMESTAMP, lease_owner = NULL,
         lease_expires_at = NULL, error = COALESCE(error, 'Recovered expired scheduler lease')
     WHERE status = 'running' AND lease_expires_at < CURRENT_TIMESTAMP`,
  );
  await heartbeat(pool);
  const heartbeatTimer = setInterval(() => heartbeat(pool).catch((error) => {
    runtime.lastError = error instanceof Error ? error.message : String(error);
  }), 30000);

  let boundaryTimer;
  const scheduleNext = () => {
    const delay = millisecondsUntilNextBoundary(Date.now(), INTERVAL_MS);
    boundaryTimer = setTimeout(async () => {
      await runSourceCheck(pool, new Date(floorToInterval(Date.now(), INTERVAL_MS)));
      scheduleNext();
    }, delay);
  };

  if (runtime.leader && INGESTION_ENABLED) {
    await runSourceCheck(pool, new Date(floorToInterval(Date.now(), INTERVAL_MS)));
    scheduleNext();
  }

  const shutdown = async (signal) => {
    runtime.status = "stopping";
    clearInterval(heartbeatTimer);
    clearTimeout(boundaryTimer);
    await heartbeat(pool).catch(() => {});
    if (runtime.leader) await leaderClient.query("SELECT pg_advisory_unlock(68421937)").catch(() => {});
    leaderClient.release();
    await pool.end();
    console.log(`${SERVICE_NAME} stopped after ${signal}`);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  console.log(JSON.stringify({ event: "scheduler_started", instanceId: INSTANCE_ID, ...runtime }));
}

main().catch((error) => {
  console.error("Scheduler failed to start", error);
  process.exit(1);
});
