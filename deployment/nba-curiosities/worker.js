import { publish } from "./publication.js";
const PREFIX = "/backend/nba";
const FILES = new Set([
  "/index.html",
  "/style.css",
  "/app.js",
  "/engine.js",
  "/snapshot.json",
  "/discoveries.json",
]);

export async function handleRequest(request, env, sessionFetch = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + "/"))
    return new Response("Not found", { status: 404 });
  if (url.pathname === PREFIX + "/_publish") return publish(request, env);
  if (!["GET", "HEAD"].includes(request.method))
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  // Only set in ignored .dev.vars. Production has no authentication bypass.
  const local = env.NBA_LOCAL_DEV === "true";
  if (!local) {
    let authenticated = false;
    try {
      const session = await sessionFetch(
        "https://cartdotcom.com/api/auth/session",
        {
          headers: {
            Cookie: request.headers.get("Cookie") || "",
            Accept: "application/json",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!session.ok) throw new Error("Session unavailable");
      authenticated = (await session.json()).authenticated === true;
    } catch {
      return new Response(
        "Login verification is temporarily unavailable. Please retry.",
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "10" },
        },
      );
    }
    if (!authenticated) {
      if ((request.headers.get("Accept") || "").includes("text/html")) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/login.html?next=" + encodeURIComponent(PREFIX + "/"),
            "Cache-Control": "no-store",
          },
        });
      }
      return new Response(JSON.stringify({ error: "Backend login required" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    }
  }
  let path = url.pathname.slice(PREFIX.length);
  if (!path || path === "/") path = "/index.html";
  if (path === "/bundle.json") {
    let bundle;
    try {
      bundle = await env.NBA_PUBLICATIONS?.get("latest");
    } catch {
      /* Serve the bundled verified generation if storage is unavailable. */
    }
    if (!bundle) {
      const [s, c] = await Promise.all(
        ["snapshot.json", "discoveries.json"].map((file) =>
          env.ASSETS.fetch(new Request(new URL("/" + file, request.url))),
        ),
      );
      if (!s.ok || !c.ok)
        return new Response("Snapshot not ready", { status: 503 });
      bundle = JSON.stringify({
        snapshot: await s.json(),
        catalogue: await c.json(),
      });
    }
    return new Response(request.method === "HEAD" ? null : bundle, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (!FILES.has(path)) return new Response("Not found", { status: 404 });
  const assetUrl = new URL(path, request.url);
  const response = await env.ASSETS.fetch(
    new Request(assetUrl, { method: request.method }),
  );
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  return new Response(response.body, { status: response.status, headers });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
