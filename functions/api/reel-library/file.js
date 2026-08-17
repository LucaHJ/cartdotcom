import { json, requireBackendSession } from "../../_lib/backend-auth.js";
import { getReelLibraryFile, getReelLibraryKV } from "../../_lib/reel-library.js";

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok ? context.data.backendSession : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);
    const kv = getReelLibraryKV(context.env);
    if (!kv) return json({ error: "Reel Library KV binding is required." }, 503);
    let file;
    try {
        file = await getReelLibraryFile(kv, new URL(context.request.url).searchParams.get("path"));
    } catch (error) {
        return json({ error: error.message || "Invalid file path." }, 400);
    }
    if (!file) return json({ error: "HTML file was not found." }, 404);
    return json({ ok: true, file });
}
