import http from "node:http";

const service = process.env.REEL_SERVICE_NAME || "reel-service";
const port = Number(process.env.PORT || 3100);
const disabledFlags = {
  intake: process.env.REEL_INTAKE_ENABLED || "false",
  dispatch: process.env.REEL_DISPATCH_ENABLED || "false",
  worker: process.env.REEL_WORKER_ENABLED || "false",
  codex: process.env.REEL_CODEX_ENABLED || "false",
  outbound: process.env.REEL_OUTBOUND_ENABLED || "false",
  mutations: process.env.REEL_MUTATIONS_ENABLED || "false",
  backlog: process.env.REEL_BACKLOG_ENABLED || "false",
  publisher: process.env.REEL_PUBLISHER_ENABLED || "false",
  archiver: process.env.REEL_ARCHIVER_ENABLED || "false",
  authRotator: process.env.REEL_AUTH_ROTATOR_ENABLED || "false"
};

function body() {
  return {
    ok: true,
    service,
    phase: process.env.REEL_PHASE || "phase1-inert",
    authority: process.env.REEL_PROCESSING_AUTHORITY || "cloud",
    workerConcurrency: Number(process.env.REEL_WORKER_CONCURRENCY || 1),
    enabled: disabledFlags
  };
}

function sendJson(response, statusCode, payload) {
  const text = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(text);
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && (request.url === "/healthz" || request.url === "/readyz")) {
    sendJson(response, 200, body());
    return;
  }

  sendJson(response, 503, {
    ok: false,
    service,
    phase: process.env.REEL_PHASE || "phase1-inert",
    reason: "phase1_inert_scaffold_no_mutations"
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`${service} inert health service listening on ${port}`);
});
