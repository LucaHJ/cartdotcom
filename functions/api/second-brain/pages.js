import { json, requireBackendSession } from "../../_lib/backend-auth.js";
import { getManifest, getSecondBrainKV, listPages, missingSecondBrainKV, putManifest } from "../../_lib/second-brain.js";

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const kv = getSecondBrainKV(context.env);
    if (!kv) return missingSecondBrainKV();

    const refresh = new URL(context.request.url).searchParams.get("refresh") === "1";
    const manifest = refresh ? null : await getManifest(kv);
    if (manifest) {
        return json({
            ok: true,
            count: manifest.pages.length,
            source: "manifest",
            generated_at: manifest.generated_at,
            pages: manifest.pages
        }, 200, { "cache-control": "private, max-age=300" });
    }

    const pages = await listPages(kv);
    await putManifest(kv, pages);
    return json({
        ok: true,
        count: pages.length,
        source: "list",
        pages
    }, 200, { "cache-control": "private, max-age=120" });
}

export async function onRequestPost(context) {
    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const kv = getSecondBrainKV(context.env);
    if (!kv) return missingSecondBrainKV();

    const pages = await listPages(kv);
    const manifest = await putManifest(kv, pages);
    return json({
        ok: true,
        manifest
    }, 200, { "cache-control": "private, max-age=300" });
}
