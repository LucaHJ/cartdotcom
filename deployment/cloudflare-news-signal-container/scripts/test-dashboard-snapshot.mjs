import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const baseUrl = String(process.env.SNAPSHOT_TEST_BASE_URL || "http://127.0.0.1:8791").replace(/\/+$/, "");
const dashboardToken = process.env.SNAPSHOT_TEST_DASHBOARD_TOKEN || "test-dashboard";
const uploadToken = process.env.SNAPSHOT_TEST_UPLOAD_TOKEN || "test-upload";
const offsiteToken = process.env.SNAPSHOT_TEST_OFFSITE_TOKEN || "test-offsite";
const entries = [
  ["status", "/api/status"],
  ["status_live", "/api/status/live"],
  ["results", "/api/results?limit=20"],
  ["jobs", "/api/jobs?limit=12"],
  ["failed_jobs", "/api/jobs/failures?limit=500"],
  ["model_experiments", "/api/model-experiments"],
  ["prediction_outcomes", "/api/predictions/outcomes?limit=50&sort=newest"],
  ["prediction_summary", "/api/predictions/summary"],
  ["prediction_daily", "/api/predictions/daily"],
  ["ticker_pipeline", "/api/diagnostics/ticker-pipeline"],
  ["source_activity", "/api/source-activity?mode=day"],
  ["source_stats", "/api/source-stats"],
];
const responses = Object.fromEntries(entries.map(([key, path]) => [key, {
  request_path: path,
  status: 200,
  body: key === "status" ? { ok: true, fixture: "offline-status" } : { ok: true, fixture: key },
}]));
const snapshot = {
  version: 1,
  generated_at: new Date().toISOString(),
  response_count: entries.length,
  content_sha256: createHash("sha256").update(JSON.stringify(responses)).digest("hex"),
  responses,
};

async function request(path, options = {}) {
  return fetch(baseUrl + path, { signal: AbortSignal.timeout(15_000), ...options });
}

let response = await request("/api/internal/dashboard-snapshot", {
  method: "POST",
  headers: { authorization: "Bearer wrong", "content-type": "application/json" },
  body: JSON.stringify(snapshot),
});
assert.equal(response.status, 401, "upload must reject the wrong credential");

response = await request("/api/internal/dashboard-snapshot", {
  method: "POST",
  headers: { authorization: `Bearer ${uploadToken}`, "content-type": "application/json" },
  body: JSON.stringify(snapshot),
});
assert.equal(response.status, 200, await response.text());

response = await request("/api/snapshot/status");
assert.equal(response.status, 401, "snapshot metadata must remain private");

response = await request("/api/snapshot/status", {
  headers: { authorization: `Bearer ${dashboardToken}` },
});
assert.equal(response.status, 200);
assert.equal((await response.json()).available, true);

response = await request("/api/status", {
  headers: { authorization: `Bearer ${dashboardToken}` },
});
assert.equal(response.status, 200);
assert.equal(response.headers.get("x-news-signal-mode"), "snapshot");
assert.equal(response.headers.get("x-news-signal-snapshot-at"), snapshot.generated_at);
assert.deepEqual(await response.json(), { ok: true, fixture: "offline-status" });

response = await request("/api/ingest", {
  method: "POST",
  headers: { authorization: `Bearer ${dashboardToken}` },
});
assert.equal(response.status, 503, "mutations must never be answered from a snapshot");

const corpusBody = Buffer.from(JSON.stringify({ content: { plaintext: "off-site fixture" } }));
const corpusHash = createHash("sha256").update(corpusBody).digest("hex");
const corpusKey = `articles/2026/08/19/test/${corpusHash}.json`;
response = await request("/api/internal/offsite-object", {
  method: "POST",
  headers: {
    authorization: "Bearer wrong",
    "content-type": "application/json",
    "x-object-key": corpusKey,
    "x-content-sha256": corpusHash,
  },
  body: corpusBody,
});
assert.equal(response.status, 401, "off-site storage must reject the wrong credential");

response = await request("/api/internal/offsite-object", {
  method: "POST",
  headers: {
    authorization: `Bearer ${offsiteToken}`,
    "content-type": "application/json",
    "x-object-key": corpusKey,
    "x-content-sha256": corpusHash,
  },
  body: corpusBody,
});
assert.equal(response.status, 200, await response.text());

console.log("Dashboard snapshot gateway checks passed.");
