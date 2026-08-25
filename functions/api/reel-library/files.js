import { json, requireBackendSession } from "../../_lib/backend-auth.js";
import { getLiveReelLibraryManifest, getReelLibraryKV, getReelLibraryManifest } from "../../_lib/reel-library.js";

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok ? context.data.backendSession : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);
    try {
        const live = await getLiveReelLibraryManifest(context.env);
        if (live) return json({ ok: true, source: "ubuntu", ...live });
    } catch (_error) {
        // The authenticated cloud static copy is the deliberate outage fallback.
    }
    const kv = getReelLibraryKV(context.env);
    if (!kv) return json({ error: "Reel Library is unavailable." }, 503);
    const manifest = await getReelLibraryManifest(kv);
    return json({ ok: true, source: "cloud-static-fallback", ...manifest });
}
