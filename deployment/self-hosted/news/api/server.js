import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { WebSocketServer } from "ws";
import { createPredictionApi } from "./predictions.js";
import { createAnalyticsApi } from "./analytics.js";
import { processingAuthority } from "./common/authority.js";

const { Pool } = pg;
const port = Number.parseInt(process.env.PORT || "3000", 10);
const passwordFile = process.env.PGPASSWORD_FILE;
const dashboardTokenFile = process.env.DASHBOARD_TOKEN_FILE;
const runtimeControlTokenFile = process.env.RUNTIME_CONTROL_TOKEN_FILE;
const codexAuthRotatorUrl = process.env.CODEX_AUTH_ROTATOR_URL || "http://auth-rotator:3011/rotate";
const corpusRoot = path.resolve(process.env.ARTICLE_CORPUS_ROOT || "/data/article-corpus");
const mutationsEnabled = /^(1|true|yes)$/i.test(process.env.API_MUTATIONS_ENABLED || "false");

if (!passwordFile) {
  throw new Error("PGPASSWORD_FILE is required");
}

const password = (await readFile(passwordFile, "utf8")).trim();
const dashboardToken = dashboardTokenFile ? (await readFile(dashboardTokenFile, "utf8")).trim() : null;
const runtimeControlToken = runtimeControlTokenFile ? (await readFile(runtimeControlTokenFile, "utf8")).trim() : null;
const dashboardHtml = await readFile(new URL("./dashboard.html", import.meta.url), "utf8");
const pool = new Pool({
  host: process.env.PGHOST,
  port: Number.parseInt(process.env.PGPORT || "5432", 10),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
const predictions = createPredictionApi(pool);
const analytics = createAnalyticsApi(pool);

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function tokensEqual(candidate, expected) {
  if (!candidate || !expected) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

function cookieValue(request, name) {
  const prefix = `${name}=`;
  const entry = (request.headers.cookie || "").split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return null;
  }
}

function isAuthorized(request) {
  if (!dashboardToken) return true;
  const authorization = request.headers.authorization || "";
  if (authorization.startsWith("Bearer ") && tokensEqual(authorization.slice(7), dashboardToken)) return true;
  const authProtocol = (request.headers["sec-websocket-protocol"] || "")
    .split(",")
    .map((value) => value.trim())
    .find((value) => value.startsWith("auth."));
  if (authProtocol) {
    try {
      const websocketToken = Buffer.from(authProtocol.slice(5), "base64url").toString("utf8");
      if (tokensEqual(websocketToken, dashboardToken)) return true;
    } catch {
      // Continue to cookie authentication.
    }
  }
  return tokensEqual(cookieValue(request, "news_signal_token"), dashboardToken);
}

function html(response, content) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(content);
}

function corpusObjectPath(objectKey) {
  const candidate = path.resolve(corpusRoot, objectKey);
  const relative = path.relative(corpusRoot, candidate);
  if (!objectKey || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid corpus object key");
  }
  return candidate;
}

async function databaseCounts() {
  const result = await pool.query(`
    SELECT
      (SELECT count(*)::integer FROM articles) AS articles,
      (SELECT count(*)::integer FROM research_jobs) AS jobs,
      (SELECT count(*)::integer FROM research_results) AS results,
      (SELECT count(*)::integer FROM prediction_outcomes) AS predictions,
      (SELECT count(*)::integer FROM research_jobs WHERE status = 'pending') AS pending_jobs,
      (SELECT count(*)::integer FROM research_jobs WHERE status = 'running') AS running_jobs
  `);
  return result.rows[0];
}

function requestLimit(url, fallback = 25) {
  const requested = Number.parseInt(url.searchParams.get("limit") || String(fallback), 10);
  return Math.min(Math.max(Number.isFinite(requested) ? requested : fallback, 1), 500);
}

async function operationTelemetry() {
  const [summary, active] = await Promise.all([
    pool.query(`
      SELECT
        count(*) FILTER (WHERE research_jobs.status = 'pending')::integer AS pending,
        count(*) FILTER (WHERE research_jobs.status = 'running')::integer AS running,
        count(*) FILTER (WHERE research_jobs.status = 'failed')::integer AS failed,
        avg(research_jobs.synthesis_duration_seconds) FILTER (WHERE research_jobs.status = 'succeeded') AS average_synthesis_seconds,
        count(research_jobs.synthesis_duration_seconds) FILTER (WHERE research_jobs.status = 'succeeded')::integer AS synthesis_samples,
        avg(research_jobs.prediction_delay_seconds) FILTER (
          WHERE research_jobs.status = 'succeeded'
            AND research_jobs.prediction_delay_eligible = 1
            AND coalesce(articles.source_id, '') != 'yahoo-finance'
        ) AS average_prediction_delay_seconds,
        count(research_jobs.prediction_delay_seconds) FILTER (
          WHERE research_jobs.status = 'succeeded'
            AND research_jobs.prediction_delay_eligible = 1
            AND coalesce(articles.source_id, '') != 'yahoo-finance'
        )::integer AS prediction_delay_samples
      FROM research_jobs
      INNER JOIN articles ON articles.id = research_jobs.article_id
    `),
    pool.query(`
      SELECT id, research_slot,
        greatest(0, extract(epoch FROM (CURRENT_TIMESTAMP - started_at)))::integer AS elapsed_synthesis_seconds
      FROM research_jobs
      WHERE status = 'running'
      ORDER BY research_slot ASC NULLS LAST
    `),
  ]);

  const row = summary.rows[0];
  const numberOrNull = (value) => value === null || value === undefined ? null : Number(value);
  const pending = Number(row.pending || 0);
  const running = Number(row.running || 0);
  const averageSynthesis = numberOrNull(row.average_synthesis_seconds);
  return {
    jobs: [
      { status: "pending", count: pending },
      { status: "running", count: running },
      { status: "failed", count: Number(row.failed || 0) },
    ],
    active_jobs: active.rows,
    timing: {
      average_synthesis_seconds: averageSynthesis,
      synthesis_samples: Number(row.synthesis_samples || 0),
      average_prediction_delay_seconds: numberOrNull(row.average_prediction_delay_seconds),
      prediction_delay_samples: Number(row.prediction_delay_samples || 0),
      estimated_queue_seconds: averageSynthesis === null ? null : Math.ceil(((pending + running) * averageSynthesis) / 8),
      parallel_capacity: 8,
    },
  };
}

async function latestSourceCheck() {
  const result = await pool.query("SELECT * FROM source_checks ORDER BY checked_at DESC LIMIT 1");
  return result.rows[0] || null;
}

async function runtimeServices() {
  const result = await pool.query(`
    SELECT service_name, instance_id, started_at, heartbeat_at, status, detail_json,
      EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - heartbeat_at))::integer AS heartbeat_age_seconds
    FROM service_heartbeats
    ORDER BY service_name
  `);
  return result.rows;
}

async function compatibilityStatus() {
  const [articles, jobs, results, predictions, content, operations, sourceCheck, sourceCount, services, authority] = await Promise.all([
    pool.query("SELECT status, count(*)::integer AS count FROM articles WHERE status != 'archived' GROUP BY status"),
    pool.query(`
      SELECT research_jobs.status, count(*)::integer AS count
      FROM research_jobs
      INNER JOIN articles ON articles.id = research_jobs.article_id
      WHERE articles.status != 'archived'
        AND (research_jobs.status != 'succeeded' OR EXISTS (
          SELECT 1 FROM research_results
          WHERE research_results.job_id = research_jobs.id
            AND research_results.symbols IS NOT NULL
            AND btrim(research_results.symbols) NOT IN ('', '[]')
        ))
      GROUP BY research_jobs.status
    `),
    pool.query(`
      SELECT count(*)::integer AS count
      FROM research_results
      INNER JOIN articles ON articles.id = research_results.article_id
      WHERE articles.status != 'archived'
        AND research_results.symbols IS NOT NULL
        AND btrim(research_results.symbols) NOT IN ('', '[]')
    `),
    pool.query("SELECT count(*)::integer AS count FROM prediction_outcomes"),
    pool.query("SELECT content_status AS status, count(*)::integer AS count FROM articles GROUP BY content_status"),
    operationTelemetry(),
    latestSourceCheck(),
    pool.query("SELECT count(*)::integer AS count FROM sources WHERE enabled != 0"),
    runtimeServices(),
    processingAuthority(pool),
  ]);

  return {
    ok: true,
    articles: articles.rows,
    jobs: jobs.rows,
    results: results.rows[0],
    predictions: predictions.rows[0],
    content: content.rows,
    timing: operations.timing,
    latest_source_check: sourceCheck,
    configured_source_count: sourceCount.rows[0].count,
    runtime_services: services,
    processing_authority: authority,
  };
}

async function readJsonBody(request, maxBytes = 100_000) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

async function mutationAuthority() {
  const authority = await processingAuthority(pool);
  return { authority, allowed: mutationsEnabled && authority.owner === "self_hosted" };
}

async function queuePendingResearchJobs(limit) {
  const result = await pool.query(
    `WITH pending AS (
       SELECT jobs.id, jobs.article_id
       FROM research_jobs AS jobs
       INNER JOIN articles ON articles.id = jobs.article_id
       WHERE jobs.status = 'pending' AND articles.status != 'archived'
       ORDER BY jobs.queued_at, jobs.id
       LIMIT $1
     )
     INSERT INTO local_job_queue
       (id, research_job_id, kind, priority, status, payload_json)
     SELECT concat('production:', pending.id), pending.id, 'production', 100, 'pending',
       jsonb_build_object('jobId', pending.id, 'articleId', pending.article_id)
     FROM pending
     ON CONFLICT (research_job_id) DO UPDATE SET
       status = CASE WHEN local_job_queue.status IN ('failed', 'cancelled') THEN 'pending' ELSE local_job_queue.status END,
       available_at = CASE WHEN local_job_queue.status IN ('failed', 'cancelled') THEN CURRENT_TIMESTAMP ELSE local_job_queue.available_at END,
       lease_owner = CASE WHEN local_job_queue.status IN ('failed', 'cancelled') THEN NULL ELSE local_job_queue.lease_owner END,
       lease_expires_at = CASE WHEN local_job_queue.status IN ('failed', 'cancelled') THEN NULL ELSE local_job_queue.lease_expires_at END,
       last_error = CASE WHEN local_job_queue.status IN ('failed', 'cancelled') THEN NULL ELSE local_job_queue.last_error END,
       finished_at = CASE WHEN local_job_queue.status IN ('failed', 'cancelled') THEN NULL ELSE local_job_queue.finished_at END,
       updated_at = CURRENT_TIMESTAMP
     RETURNING research_job_id`,
    [limit],
  );
  return result.rowCount;
}

async function recoverResearchQueue(limit, includeFailed = false) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const expired = await client.query(
      `UPDATE local_job_queue
       SET status = 'pending', available_at = CURRENT_TIMESTAMP,
           lease_owner = NULL, lease_expires_at = NULL,
           last_error = COALESCE(last_error, 'Recovered expired local lease'),
           updated_at = CURRENT_TIMESTAMP
       WHERE status = 'running' AND lease_expires_at < CURRENT_TIMESTAMP
       RETURNING research_job_id`,
    );
    if (expired.rowCount) {
      await client.query(
        `UPDATE research_jobs SET status = 'pending', research_slot = NULL,
           started_at = NULL, finished_at = NULL
         WHERE id = ANY($1::text[])`,
        [expired.rows.map((row) => row.research_job_id)],
      );
    }
    let remediated = 0;
    if (includeFailed) {
      const failed = await client.query(
        `WITH candidates AS (
           SELECT jobs.id, jobs.article_id
           FROM research_jobs AS jobs
           INNER JOIN articles ON articles.id = jobs.article_id
           WHERE jobs.status = 'failed'
           ORDER BY jobs.finished_at DESC NULLS LAST
           LIMIT $1
         )
         UPDATE research_jobs AS jobs
         SET status = 'pending', last_error = NULL, started_at = NULL,
             finished_at = NULL, synthesis_duration_seconds = NULL,
             prediction_delay_seconds = NULL, research_slot = NULL
         FROM candidates
         WHERE jobs.id = candidates.id
         RETURNING jobs.id, jobs.article_id`,
        [limit],
      );
      remediated = failed.rowCount;
      if (failed.rowCount) {
        await client.query(
          "UPDATE articles SET status = 'queued' WHERE id = ANY($1::text[])",
          [failed.rows.map((row) => row.article_id)],
        );
        await client.query(
          `UPDATE local_job_queue SET status = 'pending', attempts = 0,
             available_at = CURRENT_TIMESTAMP, lease_owner = NULL,
             lease_expires_at = NULL, last_error = NULL, finished_at = NULL,
             updated_at = CURRENT_TIMESTAMP
           WHERE research_job_id = ANY($1::text[])`,
          [failed.rows.map((row) => row.id)],
        );
      }
    }
    await client.query("COMMIT");
    const requeued = await queuePendingResearchJobs(limit);
    return { recovered: expired.rowCount, remediated, requeued };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recoverAuthenticationFailures(limit) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const failed = await client.query(
      `WITH candidates AS (
         SELECT jobs.id, jobs.article_id
         FROM research_jobs AS jobs
         WHERE jobs.status = 'failed'
           AND jobs.last_error ~* 'authentication|access token|refresh token|log in|login'
         ORDER BY jobs.finished_at DESC NULLS LAST
         LIMIT $1
       )
       UPDATE research_jobs AS jobs
       SET status = 'pending', attempts = 0, last_error = NULL,
           started_at = NULL, finished_at = NULL, research_slot = NULL,
           synthesis_duration_seconds = NULL, prediction_delay_seconds = NULL
       FROM candidates
       WHERE jobs.id = candidates.id
       RETURNING jobs.id, jobs.article_id`,
      [limit],
    );
    if (failed.rowCount) {
      const jobIds = failed.rows.map((row) => row.id);
      await client.query("UPDATE articles SET status = 'queued' WHERE id = ANY($1::text[])", [failed.rows.map((row) => row.article_id)]);
      await client.query(
        `UPDATE local_job_queue SET status = 'pending', attempts = 0,
           available_at = CURRENT_TIMESTAMP, lease_owner = NULL,
           lease_expires_at = NULL, last_error = NULL, finished_at = NULL,
           updated_at = CURRENT_TIMESTAMP
         WHERE research_job_id = ANY($1::text[])`,
        [jobIds],
      );
    }
    await client.query("COMMIT");
    const requeued = await queuePendingResearchJobs(limit);
    return { recovered: failed.rowCount, requeued };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listQuery(sql, values = []) {
  const result = await pool.query(sql, values);
  return result.rows;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      return html(response, dashboardHtml);
    }

    if (request.method === "GET" && url.pathname === "/health/live") {
      return json(response, 200, { status: "ok", service: "news-api" });
    }

    if (request.method === "GET" && url.pathname === "/health/ready") {
      await pool.query("SELECT 1");
      return json(response, 200, { status: "ready", database: "available" });
    }

    if (url.pathname.startsWith("/api/") && !isAuthorized(request)) {
      return json(response, 401, { error: "Unauthorized" });
    }

    if (url.pathname.startsWith("/api/") && request.method !== "GET" && !url.pathname.startsWith("/api/simulation")) {
      const state = await mutationAuthority();
      if (!state.allowed) {
        return json(response, 503, {
          error: "migration_read_only",
          mutations_enabled: mutationsEnabled,
          processing_authority: state.authority.owner,
        });
      }
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const authority = await processingAuthority(pool);
      return json(response, 200, {
        service: "cartdotcom-self-hosted-news-api",
        migration_stage: authority.owner === "self_hosted" ? "active" : "shadow",
        production_authority: authority.owner,
        mutations_enabled: mutationsEnabled,
        counts: await databaseCounts(),
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const authority = await processingAuthority(pool);
      return json(response, 200, {
        ok: true,
        service: "cartdotcom-self-hosted-news-api",
        mode: mutationsEnabled && authority.owner === "self_hosted" ? "active" : "read-only-shadow",
        processing_authority: authority.owner,
      });
    }

    if (request.method === "GET" && url.pathname === "/api/status") {
      return json(response, 200, await compatibilityStatus());
    }

    if (request.method === "GET" && url.pathname === "/api/status/live") {
      return json(response, 200, {
        ok: true,
        ...(await operationTelemetry()),
        latest_source_check: await latestSourceCheck(),
        configured_source_count: Number((await pool.query("SELECT count(*)::integer AS count FROM sources WHERE enabled != 0")).rows[0].count),
        runtime_services: await runtimeServices(),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/sources") {
      return json(response, 200, {
        ok: true,
        sources: await listQuery("SELECT * FROM sources ORDER BY weight DESC, name ASC LIMIT $1", [requestLimit(url, 100)]),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/source-stats") {
      return json(response, 200, { ok: true, sources: await analytics.sourceStats() });
    }

    if (request.method === "GET" && url.pathname === "/api/source-activity") {
      return json(response, 200, await analytics.sourceActivity(url.searchParams.get("mode"), url.searchParams.get("anchor")));
    }

    if (request.method === "GET" && url.pathname === "/api/diagnostics/ticker-pipeline") {
      return json(response, 200, await analytics.tickerPipelineDiagnostics(url.searchParams.get("since")));
    }

    if (request.method === "GET" && url.pathname === "/api/source-checks") {
      return json(response, 200, {
        ok: true,
        checks: await listQuery("SELECT * FROM source_checks ORDER BY checked_at DESC LIMIT $1", [requestLimit(url)]),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/source-check-details") {
      const requestedId = url.searchParams.get("check_id");
      const checkId = requestedId || (await latestSourceCheck())?.id || null;
      const sources = checkId ? await listQuery(`
        SELECT source_check_details.*, sources.name, sources.url
        FROM source_check_details
        LEFT JOIN sources ON sources.id = source_check_details.source_id
        WHERE source_check_details.check_id = $1
        ORDER BY source_check_details.new_item_count DESC, sources.name
      `, [checkId]) : [];
      return json(response, 200, { ok: true, check_id: checkId, sources });
    }

    if (request.method === "GET" && url.pathname === "/api/articles/content") {
      const articleId = url.searchParams.get("id");
      if (!articleId) return json(response, 400, { error: "Missing article id" });
      const rows = await listQuery(`
        SELECT articles.id, articles.title, articles.url, articles.published_at, articles.discovered_at,
          articles.content_plaintext, articles.content_source, articles.content_status,
          articles.content_fetched_at, articles.content_fetch_attempts, articles.content_error,
          sources.name AS source_name, sources.source_type
        FROM articles
        LEFT JOIN sources ON sources.id = articles.source_id
        WHERE articles.id = $1
      `, [articleId]);
      return rows[0] ? json(response, 200, { ok: true, article: rows[0] }) : json(response, 404, { error: "Article not found" });
    }

    if (request.method === "GET" && url.pathname === "/api/articles") {
      return json(response, 200, {
        ok: true,
        articles: await listQuery(`
          SELECT articles.id, articles.source_id, articles.title, articles.url, articles.summary,
            articles.published_at, articles.discovered_at, articles.status, articles.content_status,
            articles.content_source, articles.content_fetched_at, articles.content_fetch_attempts,
            articles.content_error, length(articles.content_plaintext) AS content_length,
            sources.name AS source_name, sources.source_type
          FROM articles
          LEFT JOIN sources ON sources.id = articles.source_id
          WHERE articles.status != 'archived'
          ORDER BY articles.discovered_at DESC
          LIMIT $1
        `, [requestLimit(url)]),
      });
    }

    if (request.method === "GET" && (url.pathname === "/api/jobs" || url.pathname === "/api/jobs/failures")) {
      const failuresOnly = url.pathname.endsWith("/failures");
      return json(response, 200, {
        ok: true,
        jobs: await listQuery(`
          SELECT research_jobs.*, articles.title, articles.url, articles.published_at,
            CASE WHEN research_jobs.status = 'running' AND research_jobs.started_at IS NOT NULL
              THEN greatest(0, extract(epoch FROM (CURRENT_TIMESTAMP - research_jobs.started_at)))::integer
              ELSE research_jobs.synthesis_duration_seconds END AS elapsed_synthesis_seconds
          FROM research_jobs
          INNER JOIN articles ON articles.id = research_jobs.article_id
          WHERE ($1::boolean = false AND articles.status != 'archived')
             OR ($1::boolean = true AND research_jobs.status = 'failed' AND articles.status = 'archived')
          ORDER BY CASE WHEN research_jobs.status = 'running' THEN 0 ELSE 1 END,
            research_jobs.queued_at DESC
          LIMIT $2
        `, [failuresOnly, requestLimit(url)]),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/results") {
      return json(response, 200, { ok: true, results: await analytics.eventSummaries(requestLimit(url, 20)) });
    }

    if (request.method === "GET" && url.pathname === "/api/model-experiments") {
      return json(response, 200, { ok: true, ...(await analytics.modelExperiment(url.searchParams.get("id"))) });
    }

    if (request.method === "GET" && url.pathname === "/api/corpus/status") {
      const result = await pool.query(`
        SELECT
          count(*)::integer AS indexed,
          count(*) FILTER (WHERE storage_status = 'stored')::integer AS stored,
          count(*) FILTER (WHERE storage_status = 'pending')::integer AS pending,
          count(*) FILTER (WHERE storage_status = 'failed')::integer AS failed,
          count(*) FILTER (WHERE offsite_status = 'stored')::integer AS offsite_stored,
          count(*) FILTER (WHERE offsite_status = 'pending')::integer AS offsite_pending,
          count(*) FILTER (WHERE offsite_status = 'failed')::integer AS offsite_failed,
          coalesce(sum(object_bytes) FILTER (WHERE storage_status = 'stored'), 0)::bigint AS stored_bytes,
          max(stored_at) AS latest_stored_at,
          max(offsite_at) AS latest_offsite_at
        FROM article_corpus_objects
      `);
      return json(response, 200, { ok: true, ...result.rows[0] });
    }

    if (request.method === "GET" && url.pathname === "/api/corpus/objects") {
      const status = url.searchParams.get("status");
      const values = status ? [status, requestLimit(url, 100)] : [requestLimit(url, 100)];
      const filter = status ? "WHERE article_corpus_objects.storage_status = $1" : "";
      const limitParameter = status ? "$2" : "$1";
      return json(response, 200, {
        ok: true,
        objects: await listQuery(`
          SELECT article_corpus_objects.*, articles.title, articles.url, articles.published_at,
            articles.source_id, sources.name AS source_name
          FROM article_corpus_objects
          INNER JOIN articles ON articles.id = article_corpus_objects.article_id
          LEFT JOIN sources ON sources.id = articles.source_id
          ${filter}
          ORDER BY article_corpus_objects.updated_at DESC
          LIMIT ${limitParameter}
        `, values),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/corpus/article") {
      const articleId = url.searchParams.get("id");
      if (!articleId) return json(response, 400, { error: "Missing article id" });
      const result = await pool.query(
        "SELECT * FROM article_corpus_objects WHERE article_id = $1",
        [articleId],
      );
      const corpus = result.rows[0];
      if (!corpus || corpus.storage_status !== "stored" || !corpus.object_key) {
        return json(response, 404, { error: "Article corpus object is not available", corpus: corpus || null });
      }
      try {
        const content = await readFile(corpusObjectPath(corpus.object_key));
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(content);
        return;
      } catch (error) {
        if (error?.code === "ENOENT") {
          return json(response, 404, { error: "Article corpus object is missing from local storage", corpus });
        }
        throw error;
      }
    }

    if (request.method === "GET" && url.pathname === "/api/predictions/summary") {
      const [summary, coverage] = await Promise.all([predictions.summary(), predictions.coverage()]);
      return json(response, 200, { ok: true, summary, coverage });
    }

    if (request.method === "GET" && url.pathname === "/api/predictions/daily") {
      const daily = await predictions.daily();
      return json(response, 200, { ok: true, daily_series: daily.series, daily_coverage: daily.coverage });
    }

    if (request.method === "GET" && (url.pathname === "/api/predictions" || url.pathname === "/api/predictions/outcomes")) {
      const page = await predictions.page(url, requestLimit(url));
      if (url.pathname.endsWith("/outcomes")) return json(response, 200, { ok: true, ...page });
      const [summary, daily, coverage] = await Promise.all([
        predictions.summary(), predictions.daily(), predictions.coverage(),
      ]);
      return json(response, 200, {
        ok: true,
        ...page,
        summary,
        coverage,
        daily_series: daily.series,
        daily_coverage: daily.coverage,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/ingest") {
      const existing = await pool.query(
        `SELECT id FROM runtime_commands
         WHERE command = 'source_check' AND status IN ('pending', 'running')
         ORDER BY requested_at LIMIT 1`,
      );
      if (existing.rowCount) {
        return json(response, 202, { ok: true, queued: false, command_id: existing.rows[0].id });
      }
      const commandId = randomUUID();
      await pool.query(
        `INSERT INTO runtime_commands (id, command, requested_by)
         VALUES ($1, 'source_check', 'dashboard')`,
        [commandId],
      );
      return json(response, 202, { ok: true, queued: true, command_id: commandId });
    }

    if (request.method === "POST" && url.pathname === "/api/requeue-pending") {
      const requeued = await queuePendingResearchJobs(requestLimit(url, 10));
      return json(response, 200, { ok: true, requeued });
    }

    if (request.method === "POST" && url.pathname === "/api/research/recover") {
      return json(response, 200, { ok: true, ...(await recoverResearchQueue(requestLimit(url, 100), false)) });
    }

    if (request.method === "POST" && url.pathname === "/api/research/remediate-failed") {
      return json(response, 200, { ok: true, ...(await recoverResearchQueue(requestLimit(url, 100), true)) });
    }

    if (request.method === "POST" && url.pathname === "/api/articles/archive") {
      const body = await readJsonBody(request);
      const articleId = typeof body.article_id === "string" ? body.article_id.trim() : "";
      if (!articleId) return json(response, 400, { error: "Missing article_id" });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const article = await client.query("SELECT id FROM articles WHERE id = $1 FOR UPDATE", [articleId]);
        if (!article.rowCount) {
          await client.query("ROLLBACK");
          return json(response, 404, { error: "Article not found" });
        }
        await client.query("DELETE FROM prediction_daily_points_v2 WHERE outcome_id IN (SELECT id FROM prediction_outcomes WHERE article_id = $1)", [articleId]);
        await client.query("DELETE FROM market_tracking_jobs WHERE outcome_id IN (SELECT id FROM prediction_outcomes WHERE article_id = $1)", [articleId]);
        const outcomes = await client.query("DELETE FROM prediction_outcomes WHERE article_id = $1 RETURNING id", [articleId]);
        const results = await client.query("DELETE FROM research_results WHERE article_id = $1 RETURNING id", [articleId]);
        await client.query("UPDATE articles SET status = 'archived' WHERE id = $1", [articleId]);
        await client.query("COMMIT");
        return json(response, 200, {
          ok: true,
          article_id: articleId,
          removed_predictions: outcomes.rowCount,
          removed_results: results.rowCount,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    if (request.method === "POST" && url.pathname === "/api/predictions/process") {
      return json(response, 202, { ok: true, queued: true, owner: "market-tracker" });
    }

    if (request.method === "POST" && url.pathname === "/api/research/auth/rotate") {
      if (!runtimeControlToken) return json(response, 503, { error: "runtime_control_unavailable" });
      const body = await readJsonBody(request, 110_000);
      const authJson = typeof body.auth_json === "string" ? body.auth_json.trim() : "";
      if (!authJson) return json(response, 400, { error: "Select a Codex auth.json file." });
      const rotated = await fetch(codexAuthRotatorUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${runtimeControlToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ auth_json: authJson }),
        signal: AbortSignal.timeout(10_000),
      });
      const rotation = await rotated.json().catch(() => ({}));
      if (!rotated.ok) return json(response, rotated.status, { error: rotation.error || "Codex authentication rotation failed" });
      const recovery = await recoverAuthenticationFailures(500);
      return json(response, 200, { ok: true, recycled: 0, ...recovery });
    }

    if (request.method === "POST" && (
      url.pathname.startsWith("/api/model-experiments/")
      || url.pathname === "/api/process-next"
      || url.pathname === "/api/process-batch"
    )) {
      return json(response, 501, { error: "local_control_not_implemented" });
    }

    if (url.pathname.startsWith("/api/simulation")) {
      return json(response, 410, {
        error: "Paper trading simulation has been decommissioned. Use /api/predictions for prediction outcome measurement.",
      });
    }

    if (url.pathname.startsWith("/api/") && request.method !== "GET") {
      return json(response, 404, { error: "not_found" });
    }

    return json(response, 404, { error: "not_found" });
  } catch (error) {
    console.error("request_failed", error);
    return json(response, Number(error?.statusCode || 503), { error: error?.message || "service_unavailable" });
  }
});

const webSocketServer = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) => protocols.has("news-signal") ? "news-signal" : false,
});

function broadcastDashboardEvent(event) {
  const payload = typeof event === "string" ? event : JSON.stringify(event);
  for (const socket of webSocketServer.clients) {
    if (socket.readyState === 1) socket.send(payload);
  }
}

webSocketServer.on("connection", (socket) => {
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  socket.on("message", (message) => {
    if (message.toString() === "ping") socket.send("pong");
  });
  socket.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname !== "/api/events" || !isAuthorized(request)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit("connection", webSocket, request);
  });
});

const webSocketHeartbeat = setInterval(() => {
  for (const socket of webSocketServer.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 30_000);
webSocketHeartbeat.unref();

let eventListener = null;
let eventReconnectTimer = null;
async function connectEventListener() {
  try {
    eventListener = await pool.connect();
    eventListener.on("notification", (message) => {
      if (message.channel !== "dashboard_events" || !message.payload) return;
      broadcastDashboardEvent(message.payload);
    });
    eventListener.on("error", (error) => {
      console.error("dashboard_event_listener_error", error.message);
      eventListener?.release(true);
      eventListener = null;
      scheduleEventListenerReconnect();
    });
    await eventListener.query("LISTEN dashboard_events");
    console.log("dashboard_event_listener_ready");
  } catch (error) {
    console.error("dashboard_event_listener_connect_failed", error.message);
    eventListener?.release(true);
    eventListener = null;
    scheduleEventListenerReconnect();
  }
}

function scheduleEventListenerReconnect() {
  if (eventReconnectTimer) return;
  eventReconnectTimer = setTimeout(() => {
    eventReconnectTimer = null;
    connectEventListener();
  }, 5_000);
  eventReconnectTimer.unref();
}

async function shutdown(signal) {
  console.log(`received_${signal.toLowerCase()}`);
  clearInterval(webSocketHeartbeat);
  if (eventReconnectTimer) clearTimeout(eventReconnectTimer);
  webSocketServer.close();
  eventListener?.release();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen(port, "0.0.0.0", () => {
  console.log(`news_api_listening port=${port}`);
});
connectEventListener();
