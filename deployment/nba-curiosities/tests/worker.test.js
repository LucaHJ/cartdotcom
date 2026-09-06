import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../worker.js";
const request = (path = "/", headers = {}) =>
  new Request("https://cartdotcom.com/backend/nba" + path, { headers });
const env = {
  ASSETS: { fetch: async (r) => new Response(new URL(r.url).pathname) },
};
test("private JSON is denied to a logged-out visitor", async () => {
  const r = await handleRequest(request("/snapshot.json"), env, async () =>
    Response.json({ authenticated: false }),
  );
  assert.equal(r.status, 401);
  assert.equal(r.headers.get("cache-control"), "no-store");
});
test("HTML redirects to the existing login", async () => {
  const r = await handleRequest(
    request("/", { Accept: "text/html" }),
    env,
    async () => Response.json({ authenticated: false }),
  );
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location"), /^\/login.html/);
});
test("session errors fail closed", async () => {
  assert.equal(
    (
      await handleRequest(request(), env, async () => {
        throw Error("down");
      })
    ).status,
    503,
  );
});
test("authenticated visitors receive assets with private caching and CSP", async () => {
  const r = await handleRequest(
    request("/snapshot.json", { Cookie: "test=value" }),
    env,
    async (url, init) => {
      assert.equal(url, "https://cartdotcom.com/api/auth/session");
      assert.equal(init.headers.Cookie, "test=value");
      return Response.json({ authenticated: true });
    },
  );
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "/snapshot.json");
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.ok(r.headers.has("content-security-policy"));
});
test("allowlisted files only; unrelated paths and write methods are rejected", async () => {
  assert.equal(
    (
      await handleRequest(request("/worker.js"), env, async () =>
        Response.json({ authenticated: true }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await handleRequest(
        new Request("https://cartdotcom.com/backend/nbatest"),
        env,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await handleRequest(
        new Request("https://cartdotcom.com/backend/nba/", { method: "POST" }),
        env,
      )
    ).status,
    405,
  );
});
