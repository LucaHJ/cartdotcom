import assert from "node:assert/strict";
import test from "node:test";
import { SNAPSHOT_ENDPOINTS, collectSnapshot, uploadSnapshot } from "./snapshot.js";

test("collectSnapshot captures every configured response without credentials", async () => {
  const requests = [];
  const snapshot = await collectSnapshot({
    origin: "http://news-api:3000/",
    token: "dashboard-secret",
    generatedAt: "2026-08-19T08:00:00.000Z",
    concurrency: 2,
    fetchImpl: async (url, options) => {
      requests.push({ url, authorization: options.headers.authorization });
      return new Response(JSON.stringify({ ok: true, path: new URL(url).pathname }), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.response_count, SNAPSHOT_ENDPOINTS.length);
  assert.equal(Object.keys(snapshot.responses).length, SNAPSHOT_ENDPOINTS.length);
  assert.match(snapshot.content_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(snapshot).includes("dashboard-secret"), false);
  assert.equal(requests.every((request) => request.authorization === "Bearer dashboard-secret"), true);
});

test("collectSnapshot rejects a partial snapshot", async () => {
  await assert.rejects(
    collectSnapshot({
      origin: "http://news-api:3000",
      token: "token",
      fetchImpl: async (url) => new URL(url).pathname === "/api/status"
        ? new Response("upstream failed", { status: 500, headers: { "content-type": "text/plain" } })
        : new Response("{}", { headers: { "content-type": "application/json" } }),
    }),
    /status returned HTTP 500/,
  );
});

test("uploadSnapshot uses its separate bearer credential", async () => {
  let request;
  const result = await uploadSnapshot({
    uploadUrl: "https://example.test/api/internal/dashboard-snapshot",
    uploadToken: "upload-secret",
    snapshot: { version: 1 },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(request.options.headers.authorization, "Bearer upload-secret");
});
