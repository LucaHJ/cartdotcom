import { createHash } from "node:crypto";

export const SNAPSHOT_VERSION = 1;

export const SNAPSHOT_ENDPOINTS = Object.freeze([
  { key: "status", path: "/api/status" },
  { key: "status_live", path: "/api/status/live" },
  { key: "results", path: "/api/results?limit=20" },
  { key: "jobs", path: "/api/jobs?limit=12" },
  { key: "failed_jobs", path: "/api/jobs/failures?limit=500" },
  { key: "model_experiments", path: "/api/model-experiments" },
  { key: "prediction_outcomes", path: "/api/predictions/outcomes?limit=50&sort=newest" },
  { key: "prediction_summary", path: "/api/predictions/summary" },
  { key: "prediction_daily", path: "/api/predictions/daily" },
  { key: "ticker_pipeline", path: "/api/diagnostics/ticker-pipeline" },
  { key: "source_activity", path: "/api/source-activity?mode=day" },
  { key: "source_stats", path: "/api/source-stats" },
]);

function normalizedOrigin(origin) {
  return String(origin || "").replace(/\/+$/, "");
}

async function fetchEndpoint(origin, endpoint, token, fetchImpl, timeoutMs) {
  const response = await fetchImpl(normalizedOrigin(origin) + endpoint.path, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${endpoint.key} returned HTTP ${response.status}: ${text.slice(0, 180)}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(`${endpoint.key} returned ${contentType || "an unknown content type"}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${endpoint.key} returned invalid JSON`);
  }
  return {
    request_path: endpoint.path,
    status: response.status,
    body,
  };
}

export async function collectSnapshot({
  origin,
  token,
  fetchImpl = fetch,
  timeoutMs = 30_000,
  concurrency = 3,
  generatedAt = new Date().toISOString(),
}) {
  if (!origin) throw new Error("LOCAL_API_ORIGIN is required");
  if (!token) throw new Error("Dashboard token is required");

  const responses = {};
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(Number(concurrency) || 1, 1), SNAPSHOT_ENDPOINTS.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < SNAPSHOT_ENDPOINTS.length) {
      const endpoint = SNAPSHOT_ENDPOINTS[nextIndex];
      nextIndex += 1;
      responses[endpoint.key] = await fetchEndpoint(origin, endpoint, token, fetchImpl, timeoutMs);
    }
  });
  await Promise.all(workers);

  const orderedResponses = Object.fromEntries(SNAPSHOT_ENDPOINTS.map(({ key }) => [key, responses[key]]));
  const content = JSON.stringify(orderedResponses);
  return {
    version: SNAPSHOT_VERSION,
    generated_at: generatedAt,
    response_count: SNAPSHOT_ENDPOINTS.length,
    content_sha256: createHash("sha256").update(content).digest("hex"),
    responses: orderedResponses,
  };
}

export async function uploadSnapshot({ uploadUrl, uploadToken, snapshot, fetchImpl = fetch, timeoutMs = 30_000 }) {
  if (!uploadUrl) throw new Error("SNAPSHOT_UPLOAD_URL is required");
  if (!uploadToken) throw new Error("Snapshot upload token is required");
  const response = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${uploadToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(snapshot),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Snapshot upload returned HTTP ${response.status}: ${text.slice(0, 180)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Snapshot upload returned invalid JSON");
  }
}
