import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import {
  baselinePoint, buildDailyPoints, buildIntervals, fetchYahooChart, nextCheckAt, unixSeconds,
} from "./prices.js";

const { Pool } = pg;
const ENABLED = /^(1|true|yes)$/i.test(process.env.MARKET_TRACKER_ENABLED || "false");
const INSTANCE_ID = process.env.INSTANCE_ID || process.env.HOSTNAME || randomUUID();
const STARTED_AT = new Date();
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.MARKET_TRACKER_CONCURRENCY || 4)));
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 3003);
const LEASE_SECONDS = 180;
const runtime = { enabled: ENABLED, status: "starting", active: 0, completed: 0, failed: 0, lastError: null };

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
    max: CONCURRENCY + 3,
  };
}

async function heartbeat(pool) {
  await pool.query(
    `INSERT INTO service_heartbeats
       (service_name, instance_id, started_at, heartbeat_at, status, detail_json)
     VALUES ('market-tracker', $1, $2, CURRENT_TIMESTAMP, $3, $4::jsonb)
     ON CONFLICT (service_name) DO UPDATE SET
       instance_id = EXCLUDED.instance_id, started_at = EXCLUDED.started_at,
       heartbeat_at = EXCLUDED.heartbeat_at, status = EXCLUDED.status,
       detail_json = EXCLUDED.detail_json`,
    [INSTANCE_ID, STARTED_AT, runtime.status, JSON.stringify(runtime)],
  );
}

async function reconcileOutcomes(pool) {
  const result = await pool.query(
    `INSERT INTO market_tracking_jobs (outcome_id, status, next_check_at)
     SELECT outcomes.id, 'active',
       CASE
         WHEN outcomes.baseline_price IS NULL THEN CURRENT_TIMESTAMP
         WHEN COALESCE(points.max_day, -1) < GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - outcomes.prediction_at)) / 86400))
           THEN CURRENT_TIMESTAMP
         ELSE outcomes.prediction_at
           + ((GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - outcomes.prediction_at)) / 86400)) + 1) * interval '1 day')
           + interval '5 minutes'
       END
     FROM prediction_outcomes AS outcomes
     LEFT JOIN market_tracking_jobs AS tracking ON tracking.outcome_id = outcomes.id
     LEFT JOIN (
       SELECT outcome_id, MAX(day_index) AS max_day
       FROM prediction_daily_points_v2
       GROUP BY outcome_id
     ) AS points ON points.outcome_id = outcomes.id
     WHERE tracking.outcome_id IS NULL
     ON CONFLICT (outcome_id) DO NOTHING`,
  );
  return result.rowCount;
}

async function claim(pool, limit) {
  const result = await pool.query(
    `WITH candidates AS (
       SELECT outcome_id FROM market_tracking_jobs
       WHERE (status = 'active' AND next_check_at <= CURRENT_TIMESTAMP)
          OR (status = 'running' AND lease_expires_at < CURRENT_TIMESTAMP)
       ORDER BY next_check_at, outcome_id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE market_tracking_jobs AS jobs
     SET status = 'running', lease_owner = $2,
         lease_expires_at = CURRENT_TIMESTAMP + ($3 * interval '1 second'),
         attempts = jobs.attempts + 1, updated_at = CURRENT_TIMESTAMP
     FROM candidates
     WHERE jobs.outcome_id = candidates.outcome_id
     RETURNING jobs.outcome_id, jobs.consecutive_failures`,
    [limit, INSTANCE_ID, LEASE_SECONDS],
  );
  return result.rows;
}

async function loadOutcome(pool, outcomeId) {
  const result = await pool.query(
    `SELECT id, symbol, direction, prediction_at, baseline_price, baseline_at, intervals_json
     FROM prediction_outcomes WHERE id = $1`,
    [outcomeId],
  );
  return result.rows[0] || null;
}

async function persistDailyPoints(client, outcome, points) {
  if (!points.length) return;
  const existing = await client.query(
    "SELECT COALESCE(MAX(day_index), -1) AS max_day FROM prediction_daily_points_v2 WHERE outcome_id = $1",
    [outcome.id],
  );
  const maxDay = Number(existing.rows[0]?.max_day ?? -1);
  const pending = points.filter((point) => point.day_index >= Math.max(0, maxDay - 1));
  for (const point of pending) {
    await client.query(
      `INSERT INTO prediction_daily_points_v2
         (outcome_id, prediction_at, day_index, sampled_at, price, change_pct)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (outcome_id, day_index) DO UPDATE SET
         prediction_at = EXCLUDED.prediction_at, sampled_at = EXCLUDED.sampled_at,
         price = EXCLUDED.price, change_pct = EXCLUDED.change_pct`,
      [outcome.id, outcome.prediction_at, point.day_index, point.at, point.price, point.change_pct],
    );
  }
}

async function track(pool, job) {
  runtime.active += 1;
  runtime.status = "working";
  try {
    const outcome = await loadOutcome(pool, job.outcome_id);
    if (!outcome) throw new Error("Prediction outcome no longer exists.");
    const predictionAt = new Date(outcome.prediction_at).toISOString();
    const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds(predictionAt));
    const [shortChart, longChart] = await Promise.all([
      fetchYahooChart(outcome.symbol, predictionAt, "1h", Math.max(60 * 86400, ageSeconds + 2 * 86400)),
      fetchYahooChart(outcome.symbol, predictionAt, "1d", Math.max(4 * 365 * 86400 + 14 * 86400, ageSeconds + 2 * 86400)),
    ]);
    const baseline = baselinePoint(shortChart, longChart, predictionAt);
    if (!baseline) throw new Error(`No baseline market price is available for ${outcome.symbol}.`);
    const intervals = buildIntervals({
      predictionAt, direction: outcome.direction, baseline, shortChart, longChart,
    });
    const dailyPoints = buildDailyPoints({ predictionAt, baseline, chart: longChart });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const lease = await client.query(
        `SELECT outcome_id FROM market_tracking_jobs
         WHERE outcome_id = $1 AND status = 'running' AND lease_owner = $2 FOR UPDATE`,
        [outcome.id, INSTANCE_ID],
      );
      if (lease.rowCount !== 1) throw new Error("Market tracking lease was lost.");
      await client.query(
        `UPDATE prediction_outcomes
         SET baseline_price = $2, baseline_at = $3, intervals_json = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [outcome.id, baseline.price, new Date(baseline.at * 1000), JSON.stringify(intervals)],
      );
      await persistDailyPoints(client, outcome, dailyPoints);
      await client.query(
        `UPDATE market_tracking_jobs
         SET status = 'active', next_check_at = $3, lease_owner = NULL,
             lease_expires_at = NULL, consecutive_failures = 0,
             last_checked_at = CURRENT_TIMESTAMP, last_success_at = CURRENT_TIMESTAMP,
             last_error = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE outcome_id = $1 AND lease_owner = $2`,
        [outcome.id, INSTANCE_ID, nextCheckAt(predictionAt, intervals)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    runtime.completed += 1;
    runtime.lastError = null;
  } catch (error) {
    runtime.failed += 1;
    runtime.lastError = error instanceof Error ? error.message : String(error);
    const failures = Number(job.consecutive_failures || 0) + 1;
    const delaySeconds = Math.min(21600, 300 * (2 ** Math.min(6, failures - 1)));
    await pool.query(
      `UPDATE market_tracking_jobs
       SET status = 'active', next_check_at = CURRENT_TIMESTAMP + ($4 * interval '1 second'),
           lease_owner = NULL, lease_expires_at = NULL,
           consecutive_failures = $3, last_checked_at = CURRENT_TIMESTAMP,
           last_error = $2, updated_at = CURRENT_TIMESTAMP
       WHERE outcome_id = $1 AND lease_owner = $5`,
      [job.outcome_id, runtime.lastError.slice(0, 2000), failures, delaySeconds, INSTANCE_ID],
    ).catch(() => {});
    console.error(`Market tracking failed for ${job.outcome_id}`, error);
  } finally {
    runtime.active -= 1;
    runtime.status = runtime.active ? "working" : "idle";
  }
}

function startHealthServer() {
  createServer((request, response) => {
    if (request.url !== "/healthz") return response.writeHead(404).end("not found");
    response.writeHead(runtime.status === "starting" ? 503 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify(runtime));
  }).listen(HEALTH_PORT, "0.0.0.0");
}

async function main() {
  const pool = new Pool(await databaseConfig());
  startHealthServer();
  runtime.status = ENABLED ? "idle" : "disabled";
  await heartbeat(pool);
  const heartbeatTimer = setInterval(() => heartbeat(pool).catch(() => {}), 30000);
  let lastReconcile = 0;
  const pollTimer = setInterval(async () => {
    if (!ENABLED || runtime.active >= CONCURRENCY) return;
    try {
      if (Date.now() - lastReconcile > 60000) {
        await reconcileOutcomes(pool);
        lastReconcile = Date.now();
      }
      const jobs = await claim(pool, CONCURRENCY - runtime.active);
      for (const job of jobs) void track(pool, job);
    } catch (error) {
      runtime.status = "degraded";
      runtime.lastError = error instanceof Error ? error.message : String(error);
    }
  }, 3000);

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
  console.log(JSON.stringify({ event: "market_tracker_started", concurrency: CONCURRENCY, ...runtime }));
}

main().catch((error) => {
  console.error("Market tracker failed to start", error);
  process.exit(1);
});
