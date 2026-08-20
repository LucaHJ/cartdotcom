const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function parseLimit(value) {
  const parsed = Number.parseInt(value || "1000", 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error("limit must be an integer from 1 to 1000");
  }
  return parsed;
}

function serialiseObject(object) {
  return {
    key: object.key,
    size: object.size,
    etag: object.etag || null,
    uploaded: object.uploaded ? new Date(object.uploaded).toISOString() : null,
    storageClass: object.storageClass || object.storage_class || null,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }
    if (url.pathname !== "/inventory/r2/list") {
      return json({ ok: false, error: "not_found" }, 404);
    }
    if (!env.REEL_ARCHIVE || typeof env.REEL_ARCHIVE.list !== "function") {
      return json({ ok: false, error: "r2_binding_unavailable" }, 503);
    }

    let limit;
    try {
      limit = parseLimit(url.searchParams.get("limit"));
    } catch (error) {
      return json({ ok: false, error: "invalid_limit", detail: error.message }, 400);
    }

    const cursor = url.searchParams.get("cursor") || undefined;
    const result = await env.REEL_ARCHIVE.list({ limit, cursor });
    return json({
      ok: true,
      objects: (result.objects || []).map(serialiseObject),
      truncated: Boolean(result.truncated),
      cursor: result.truncated ? result.cursor || null : null,
    });
  },
};
