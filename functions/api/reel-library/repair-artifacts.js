import { json, normalizeString, requireBackendSession } from "../../_lib/backend-auth.js";

const DEFAULT_WORKER_URL = "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev";

export async function onRequestPost(context) {
    const actor = context.data.backendSession?.ok ? context.data.backendSession : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);
    const token = normalizeString(context.env.REEL_LIBRARY_SHARED_TOKEN, 4000);
    if (!token) return json({ error: "Artifact maintenance is not configured." }, 503);
    const workerUrl = normalizeString(context.env.REEL_BRAIN_WORKER_URL, 500) || DEFAULT_WORKER_URL;
    const response = await fetch(`${workerUrl}/integration/reel-library/repair-artifacts`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) return json({ error: payload.error || "Artifact profiles could not be rebuilt." }, response.status || 502);
    return json(payload, 200, { "cache-control": "no-store" });
}
