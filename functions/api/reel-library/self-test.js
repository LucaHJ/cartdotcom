import { json, normalizeString, requireBackendSession } from "../../_lib/backend-auth.js";

const DEFAULT_WORKER_URL = "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev";

export async function onRequestPost(context) {
    const actor = context.data.backendSession?.ok ? context.data.backendSession : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);
    const token = normalizeString(context.env.REEL_LIBRARY_SHARED_TOKEN, 4000);
    if (!token) return json({ error: "Reel Brain self-test access is not configured." }, 503);
    const workerUrl = normalizeString(context.env.REEL_BRAIN_WORKER_URL, 500) || DEFAULT_WORKER_URL;
    const response = await fetch(`${workerUrl}/integration/reel-library/self-test`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({}));
    return json(payload.error ? { error: payload.error } : payload, response.status || 502, { "cache-control": "no-store" });
}
