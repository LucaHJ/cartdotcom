import { json, normalizeString, requireBackendSession } from "../../_lib/backend-auth.js";

const DEFAULT_WORKER_URL = "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev";

export async function onRequestPost(context) {
    const actor = context.data.backendSession?.ok ? context.data.backendSession : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);
    const token = normalizeString(context.env.REEL_LIBRARY_SHARED_TOKEN, 4000);
    if (!token) return json({ error: "Resource reconciliation is not configured." }, 503);
    const workerUrl = normalizeString(context.env.REEL_BRAIN_WORKER_URL, 500) || DEFAULT_WORKER_URL;
    const input = await context.request.json().catch(() => ({}));
    const cursor = normalizeString(input.cursor, 4000);
    const response = await fetch(`${workerUrl}/integration/reel-library/repair-orphan-resource-aliases`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ cursor })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) return json({ error: payload.error || "Legacy resource paths could not be repaired." }, response.status || 502);
    return json(payload, 200, { "cache-control": "no-store" });
}
