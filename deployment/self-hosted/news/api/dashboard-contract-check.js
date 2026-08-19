import process from "node:process";
import WebSocket from "ws";

const baseUrl = (process.env.DASHBOARD_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
const token = process.env.DASHBOARD_TOKEN;
if (!token) throw new Error("DASHBOARD_TOKEN is required");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(60000),
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

async function expectJson(path, arrayKeys = []) {
  const startedAt = performance.now();
  const { response, body } = await request(path);
  assert(response.status === 200, `${path} returned HTTP ${response.status}`);
  assert(response.headers.get("content-type")?.includes("application/json"), `${path} did not return JSON`);
  assert(body?.ok === true, `${path} did not return ok=true`);
  for (const key of arrayKeys) assert(Array.isArray(body[key]), `${path} is missing array ${key}`);
  return { path, status: response.status, duration_ms: Math.round(performance.now() - startedAt) };
}

async function expectWebSocket() {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/api/events";
  const encodedToken = Buffer.from(token).toString("base64url");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket connection timed out")), 10000);
    const socket = new WebSocket(url, ["news-signal", `auth.${encodedToken}`]);
    socket.once("message", (message) => {
      clearTimeout(timeout);
      const event = JSON.parse(message.toString());
      assert(event.type === "connected", "WebSocket did not send the connected event");
      socket.close();
      resolve({ path: "/api/events", status: 101, duration_ms: null });
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

const checks = [];
const dashboard = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(30000) });
const dashboardHtml = await dashboard.text();
assert(dashboard.status === 200 && dashboardHtml.includes("Prediction Accuracy"), "Dashboard HTML is unavailable or incomplete");
checks.push({ path: "/", status: dashboard.status, duration_ms: null });

const unauthorized = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(30000) });
assert(unauthorized.status === 401, `Unauthorized API request returned HTTP ${unauthorized.status}`);
checks.push({ path: "/api/status (unauthorized)", status: unauthorized.status, duration_ms: null });

for (const [path, arrays] of [
  ["/api/status", ["articles", "jobs", "content", "runtime_services"]],
  ["/api/results?limit=20", ["results"]],
  ["/api/jobs?limit=12", ["jobs"]],
  ["/api/jobs/failures?limit=500", ["jobs"]],
  ["/api/model-experiments", ["progress"]],
  ["/api/predictions/outcomes?limit=100", ["outcomes"]],
  ["/api/predictions/summary", ["summary"]],
  ["/api/predictions/daily", ["daily_series"]],
  ["/api/status/live", ["jobs", "active_jobs", "runtime_services"]],
  ["/api/diagnostics/ticker-pipeline", ["article_cohorts", "recent_failure_reasons"]],
  ["/api/source-activity?mode=day", ["buckets", "ticks", "separators"]],
  ["/api/source-activity?mode=month", ["buckets", "ticks", "separators"]],
  ["/api/source-activity?mode=year", ["buckets", "ticks", "separators"]],
  ["/api/source-stats", ["sources"]],
]) checks.push(await expectJson(path, arrays));

const firstPage = await request("/api/predictions/outcomes?limit=10");
if (firstPage.body.has_more && firstPage.body.next_cursor) {
  const secondPage = await request(`/api/predictions/outcomes?limit=10&cursor=${encodeURIComponent(firstPage.body.next_cursor)}`);
  assert(secondPage.response.status === 200 && secondPage.body.ok === true, "Prediction cursor pagination failed");
  assert(secondPage.body.outcomes.length > 0, "Prediction cursor returned an empty page");
  checks.push({ path: "/api/predictions/outcomes (next cursor)", status: 200, duration_ms: null });
}

const simulation = await request("/api/simulation?limit=1");
assert(simulation.response.status === 410, `Simulation compatibility route returned HTTP ${simulation.response.status}`);
checks.push({ path: "/api/simulation", status: simulation.response.status, duration_ms: null });

const mutation = await request("/api/ingest", { method: "POST" });
assert(mutation.response.status === 503 && mutation.body?.error === "migration_read_only", "Read-only mutation guard failed");
checks.push({ path: "/api/ingest (read-only)", status: mutation.response.status, duration_ms: null });

checks.push(await expectWebSocket());
console.log(JSON.stringify({ ok: true, checked: checks.length, checks }));
