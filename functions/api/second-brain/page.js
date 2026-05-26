import { json, requireBackendSession } from "../../_lib/backend-auth.js";
import { getPage, getSecondBrainKV, missingSecondBrainKV, putPage } from "../../_lib/second-brain.js";

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const kv = getSecondBrainKV(context.env);
    if (!kv) return missingSecondBrainKV();

    const path = new URL(context.request.url).searchParams.get("path");
    let page;
    try {
        page = await getPage(kv, path);
    } catch (error) {
        return json({ error: error.message || "Invalid page path." }, 400);
    }

    if (!page) return json({ error: "Markdown page was not found." }, 404);
    return json({ ok: true, page }, 200, { "cache-control": "private, max-age=300" });
}

export async function onRequestPut(context) {
    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const kv = getSecondBrainKV(context.env);
    if (!kv) return missingSecondBrainKV();

    const body = await context.request.json().catch(() => null);
    if (!body) return json({ error: "JSON body is required." }, 400);

    let result;
    try {
        result = await putPage(kv, body.path, body.content, actor.email);
    } catch (error) {
        return json({ error: error.message || "Markdown page could not be saved." }, 400);
    }

    return json({ ok: true, page: result });
}
