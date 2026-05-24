import { createBackendSessionCookie, json, normalizeString, verifyBackendLogin } from "../../_lib/backend-auth.js";

function fetchMetadataLooksSafe(request) {
    const site = request.headers.get("sec-fetch-site");
    if (!site) return true;
    return ["same-origin", "same-site", "none"].includes(site);
}

export async function onRequestPost(context) {
    if (!fetchMetadataLooksSafe(context.request)) {
        return json({ error: "Cross-site login is blocked." }, 403);
    }

    const body = await context.request.json().catch(() => null);
    if (!body) return json({ error: "JSON body is required." }, 400);

    const username = normalizeString(body.username, 160);
    const password = String(body.password || "");
    const result = await verifyBackendLogin(context.env, username, password);
    if (!result.ok) return json({ error: result.error }, result.error.startsWith("Backend login is not configured") ? 503 : 401);

    const cookie = await createBackendSessionCookie(context.env, result);
    return json({
        ok: true,
        user: {
            username: result.username,
            email: result.email
        },
        expiresIn: result.ttlSeconds
    }, 200, { "set-cookie": cookie });
}

export async function onRequestOptions() {
    return json({ ok: true });
}
