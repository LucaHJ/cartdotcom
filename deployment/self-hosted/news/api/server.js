import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { WebSocketServer } from "ws";
import { createPredictionApi } from "./predictions.js";
import { createAnalyticsApi } from "./analytics.js";

const { Pool } = pg;
const port = Number.parseInt(process.env.PORT || "3000", 10);
const passwordFile = process.env.PGPASSWORD_FILE;
const dashboardTokenFile = process.env.DASHBOARD_TOKEN_FILE;
const corpusRoot = path.resolve(process.env.ARTICLE_CORPUS_ROOT || "/data/article-corpus");

if (!passwordFile) {
  throw new Error("PGPASSWORD_FILE is required");
}

const password = (await readFile(passwordFile, "utf8")).trim();
const dashboardToken = dashboardTokenFile ? (await readFile(dashboardTokenFile, "utf8")).trim() : null;
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
  const [articles, jobs, results, predictions, content, operations, sourceCheck, sourceCount, services] = await Promise.all([
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
  };
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

    if (request.method === "GET" && url.pathname === "/status") {
      return json(response, 200, {
        service: "cartdotcom-self-hosted-news-api",
        migration_stage: "foundation",
        production_authority: "cloudflare",
        counts: await databaseCounts(),
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: true,
        service: "cartdotcom-self-hosted-news-api",
        mode: "read-only-shadow",
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
          coalesce(sum(object_bytes) FILTER (WHERE storage_status = 'stored'), 0)::bigint AS stored_bytes,
          max(stored_at) AS latest_stored_at
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

    if (url.pathname.startsWith("/api/simulation")) {
      return json(response, 410, {
        error: "Paper trading simulation has been decommissioned. Use /api/predictions for prediction outcome measurement.",
      });
    }

    if (url.pathname.startsWith("/api/") && request.method !== "GET") {
      return json(response, 503, { error: "migration_read_only" });
    }

    return json(response, 404, { error: "not_found" });
  } catch (error) {
    console.error("request_failed", error);
    return json(response, 503, { error: "service_unavailable" });
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
