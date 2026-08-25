import { json, requireBackendSession } from "../../_lib/backend-auth.js";
import { getLiveReelLibraryFile, getReelLibraryFile, getReelLibraryKV } from "../../_lib/reel-library.js";

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok ? context.data.backendSession : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);
    let file;
    let source = "ubuntu";
    try {
        const path = new URL(context.request.url).searchParams.get("path");
        file = await getLiveReelLibraryFile(context.env, path);
        if (!file) {
            const kv = getReelLibraryKV(context.env);
            if (!kv) return json({ error: "Reel Library is unavailable." }, 503);
            file = await getReelLibraryFile(kv, path);
            source = "cloud-static-fallback";
        }
    } catch (error) {
        const kv = getReelLibraryKV(context.env);
        if (!kv) return json({ error: "Reel Library is unavailable." }, 503);
        try {
            file = await getReelLibraryFile(kv, new URL(context.request.url).searchParams.get("path"));
            source = "cloud-static-fallback";
        } catch (fallbackError) {
            return json({ error: fallbackError.message || error.message || "Invalid file path." }, 400);
        }
    }
    if (!file) return json({ error: "HTML file was not found." }, 404);
    return json({ ok: true, source, file });
}
