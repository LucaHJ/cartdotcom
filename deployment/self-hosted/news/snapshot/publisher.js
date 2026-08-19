import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { collectSnapshot, uploadSnapshot } from "./snapshot.js";

const localApiOrigin = process.env.LOCAL_API_ORIGIN || "http://news-api:3000";
const uploadUrl = process.env.SNAPSHOT_UPLOAD_URL || "";
const dashboardTokenFile = process.env.DASHBOARD_TOKEN_FILE;
const uploadTokenFile = process.env.SNAPSHOT_UPLOAD_TOKEN_FILE;
const intervalMs = Math.max(Number.parseInt(process.env.SNAPSHOT_INTERVAL_MS || "300000", 10), 60_000);
const fetchConcurrency = Math.min(Math.max(Number.parseInt(process.env.SNAPSHOT_FETCH_CONCURRENCY || "1", 10), 1), 3);
const healthPort = Number.parseInt(process.env.HEALTH_PORT || "3004", 10);

if (!dashboardTokenFile) throw new Error("DASHBOARD_TOKEN_FILE is required");
if (!uploadTokenFile) throw new Error("SNAPSHOT_UPLOAD_TOKEN_FILE is required");

const dashboardToken = (await readFile(dashboardTokenFile, "utf8")).trim();
const uploadToken = (await readFile(uploadTokenFile, "utf8")).trim();
let running = false;
let timer = null;
let lastAttemptAt = null;
let lastSuccessAt = null;
let lastSnapshotAt = null;
let lastBytes = null;
let lastError = null;

function healthPayload() {
  const staleAfterMs = intervalMs * 3;
  const successAgeMs = lastSuccessAt ? Date.now() - Date.parse(lastSuccessAt) : null;
  const degraded = Boolean(uploadUrl && lastError && (successAgeMs === null || successAgeMs > staleAfterMs));
  return {
    status: !uploadUrl ? "disabled" : degraded ? "degraded" : "ok",
    service: "dashboard-snapshot-publisher",
    enabled: Boolean(uploadUrl),
    running,
    interval_ms: intervalMs,
    fetch_concurrency: fetchConcurrency,
    last_attempt_at: lastAttemptAt,
    last_success_at: lastSuccessAt,
    last_snapshot_at: lastSnapshotAt,
    last_bytes: lastBytes,
    last_error: lastError,
  };
}

const healthServer = createServer((request, response) => {
  if (request.url !== "/healthz") {
    response.writeHead(404).end();
    return;
  }
  const payload = healthPayload();
  response.writeHead(payload.status === "degraded" ? 503 : 200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
});
healthServer.listen(healthPort, "0.0.0.0");

function scheduleNext() {
  if (!uploadUrl) return;
  const delay = intervalMs - (Date.now() % intervalMs) + 1_000;
  timer = setTimeout(runOnce, delay);
}

async function runOnce() {
  if (running || !uploadUrl) return;
  running = true;
  lastAttemptAt = new Date().toISOString();
  try {
    const snapshot = await collectSnapshot({ origin: localApiOrigin, token: dashboardToken, concurrency: fetchConcurrency });
    const serialized = JSON.stringify(snapshot);
    await uploadSnapshot({ uploadUrl, uploadToken, snapshot });
    lastSuccessAt = new Date().toISOString();
    lastSnapshotAt = snapshot.generated_at;
    lastBytes = Buffer.byteLength(serialized);
    lastError = null;
    console.log(JSON.stringify({ event: "dashboard_snapshot_published", at: lastSuccessAt, snapshot_at: lastSnapshotAt, bytes: lastBytes }));
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "dashboard_snapshot_failed", at: new Date().toISOString(), error: lastError }));
  } finally {
    running = false;
    scheduleNext();
  }
}

function shutdown() {
  if (timer) clearTimeout(timer);
  healthServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

if (uploadUrl) runOnce();
else console.log(JSON.stringify({ event: "dashboard_snapshot_disabled", reason: "SNAPSHOT_UPLOAD_URL is not configured" }));
