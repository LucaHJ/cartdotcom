import { getActor, json } from "../../_lib/mobile-auth.js";
import { getSecondBrainKV, listPages, missingSecondBrainKV, putManifest } from "../../_lib/second-brain.js";

export async function onRequestGet(context) {
    const actor = getActor(context.request, context.env, context.data);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const kv = getSecondBrainKV(context.env);
    if (!kv) return missingSecondBrainKV();

    const pages = await listPages(kv);
    return json({
        ok: true,
        count: pages.length,
        pages
    });
}

export async function onRequestPost(context) {
    const actor = getActor(context.request, context.env, context.data);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const kv = getSecondBrainKV(context.env);
    if (!kv) return missingSecondBrainKV();

    const pages = await listPages(kv);
    const manifest = await putManifest(kv, pages);
    return json({
        ok: true,
        manifest
    });
}
