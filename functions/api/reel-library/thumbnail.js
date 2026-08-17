import { json, normalizeString, requireBackendSession } from "../../_lib/backend-auth.js";

const DEFAULT_WORKER_URL = "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev";

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok ? context.data.backendSession : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);
    const jobId = normalizeString(new URL(context.request.url).searchParams.get("job_id"), 80);
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "A valid Reel job id is required." }, 400);
    const token = normalizeString(context.env.REEL_LIBRARY_SHARED_TOKEN, 4000);
    if (!token) return json({ error: "Gallery thumbnails are not configured." }, 503);
    const workerUrl = normalizeString(context.env.REEL_BRAIN_WORKER_URL, 500) || DEFAULT_WORKER_URL;
    const response = await fetch(`${workerUrl}/integration/reel-library/jobs/${encodeURIComponent(jobId)}/thumbnail`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) return json({ error: payload.error || "The thumbnail could not be opened." }, response.status || 502);
    return json(payload, 200, { "cache-control": "private, max-age=300" });
}
