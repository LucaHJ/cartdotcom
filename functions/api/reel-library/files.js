import { json, requireBackendSession } from "../../_lib/backend-auth.js";
import { getReelLibraryKV, getReelLibraryManifest } from "../../_lib/reel-library.js";

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok ? context.data.backendSession : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);
    const kv = getReelLibraryKV(context.env);
    if (!kv) return json({ error: "Reel Library KV binding is required." }, 503);
    const manifest = await getReelLibraryManifest(kv);
    return json({ ok: true, ...manifest });
}
