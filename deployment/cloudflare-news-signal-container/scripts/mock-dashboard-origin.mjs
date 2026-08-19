import { createServer } from "node:http";
import { collectSnapshot } from "../../self-hosted/news/snapshot/snapshot.js";

const dashboardToken = process.env.DASHBOARD_TOKEN;
if (!dashboardToken) throw new Error("DASHBOARD_TOKEN is required");
const snapshot = await collectSnapshot({
  origin: process.env.LOCAL_API_ORIGIN || "http://127.0.0.1:18080",
  token: dashboardToken,
  concurrency: 1,
});
const routeKeys = {
  "/api/status": "status",
  "/api/status/live": "status_live",
  "/api/results": "results",
  "/api/jobs": "jobs",
  "/api/jobs/failures": "failed_jobs",
  "/api/model-experiments": "model_experiments",
  "/api/predictions": "prediction_outcomes",
  "/api/predictions/outcomes": "prediction_outcomes",
  "/api/predictions/summary": "prediction_summary",
  "/api/predictions/daily": "prediction_daily",
  "/api/diagnostics/ticker-pipeline": "ticker_pipeline",
  "/api/source-activity": "source_activity",
  "/api/source-stats": "source_stats",
};

createServer((request, response) => {
  const key = routeKeys[new URL(request.url || "/", "http://localhost").pathname];
  if (!key) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"error":"not_found"}');
    return;
  }
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(snapshot.responses[key].body));
}).listen(Number.parseInt(process.env.PORT || "8792", 10), "127.0.0.1", () => {
  console.log("Mock dashboard origin ready");
});
