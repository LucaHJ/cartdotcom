import { json } from "../../_lib/backend-auth.js";

const QUEUE_PREFIX = "management:queue:";
const MAX_BODY_BYTES = 512 * 1024;

function getQueueKV(env) {
    return env.SECOND_BRAIN_KV || null;
}

function queueKey(id) {
    return `${QUEUE_PREFIX}${id}`;
}

function normalizeDraft(body, actor) {
    const now = new Date().toISOString();
    const draft = body && typeof body === "object" ? body : {};
    const id = String(draft.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || crypto.randomUUID();
    const projectId = String(draft.projectId || draft.analysis?.projectId || "unassigned").slice(0, 120);
    const projectName = String(draft.details?.name || draft.analysis?.projectName || projectId).slice(0, 180);

    return {
        ...draft,
        id,
        projectId,
        queuedAt: draft.queuedAt || now,
        updatedAt: now,
        status: draft.status || "queued",
        source: "management-command-console",
        actor: actor?.email || "backend-user",
        details: {
            ...(draft.details || {}),
            name: projectName
        }
    };
}

export async function onRequestGet(context) {
    const kv = getQueueKV(context.env);
    if (!kv) return json({ error: "SECOND_BRAIN_KV binding is required for the management queue." }, 503);

    const records = [];
    let cursor;
    do {
        const result = await kv.list({ prefix: QUEUE_PREFIX, cursor });
        for (const key of result.keys || []) {
            const value = await kv.get(key.name, "json");
            if (value) records.push(value);
        }
        cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    records.sort((a, b) => String(b.queuedAt || b.createdAt || "").localeCompare(String(a.queuedAt || a.createdAt || "")));
    return json({ ok: true, count: records.length, records });
}

export async function onRequestPost(context) {
    const kv = getQueueKV(context.env);
    if (!kv) return json({ error: "SECOND_BRAIN_KV binding is required for the management queue." }, 503);

    const raw = await context.request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return json({ error: "Management queue item is too large." }, 413);
    }

    let body;
    try {
        body = JSON.parse(raw || "{}");
    } catch (error) {
        return json({ error: "JSON body is required." }, 400);
    }

    const actor = context.data.backendSession || {};
    const record = normalizeDraft(body, actor);
    await kv.put(queueKey(record.id), JSON.stringify(record), {
        metadata: {
            projectId: record.projectId,
            status: record.status,
            queuedAt: record.queuedAt,
            actor: record.actor
        }
    });

    return json({ ok: true, record });
}
