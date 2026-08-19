export default {
  async fetch(request, env) {
    if (request.headers.get("x-migration-token") !== env.MIGRATION_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (url.pathname !== "/object" || !key || !key.startsWith("articles/")) {
      return new Response("Not found", { status: 404 });
    }

    const object = await env.ARTICLE_CORPUS.get(key);
    if (!object) return new Response("Not found", { status: 404 });

    const headers = new Headers({
      "cache-control": "no-store",
      "content-length": String(object.size),
      "content-type": object.httpMetadata?.contentType || "application/json",
    });
    return new Response(object.body, { headers });
  },
};
