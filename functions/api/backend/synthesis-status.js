import { json, normalizeString, requireBackendSession } from "../../_lib/backend-auth.js";

const APPROVAL_PREFIX = "mobile-auth:approval:";
const DEFAULT_INSTAGRAM_PREFIX = "instagram:intake:";

const YOUTUBE_STAGE_DEFINITIONS = [
    { id: "queued", label: "Queued", statuses: ["approved"] },
    { id: "claimed", label: "Claimed", statuses: ["running"] },
    { id: "waiting_git_publish", label: "Waiting publish", statuses: ["waiting_git_publish"] },
    { id: "failed", label: "Failed", statuses: ["failed"] },
    { id: "handled", label: "Handled", statuses: ["handled"] }
];

const INSTAGRAM_STAGE_DEFINITIONS = [
    { id: "detected", label: "Detected", kind: "total" },
    { id: "queued", label: "Queued", statuses: ["ready", "needs_manual_review"] },
    { id: "claimed", label: "Claimed", statuses: ["running"] },
    { id: "sender_gate", label: "Sender gate", statuses: ["needs_sender_allowlist"] },
    { id: "failed", label: "Failed", statuses: ["failed"] },
    { id: "handled", label: "Handled", statuses: ["handled"] }
];

function getQueueKV(env) {
    return env.MOBILE_AUTH_KV || null;
}

function configuredInstagramPrefix(env) {
    return normalizeString(env.INSTAGRAM_INTAKE_KV_PREFIX, 80) || DEFAULT_INSTAGRAM_PREFIX;
}

async function listKeys(kv, prefix) {
    const keys = [];
    let cursor;
    do {
        const options = { prefix };
        if (cursor) options.cursor = cursor;
        const listed = await kv.list(options);
        keys.push(...(listed.keys || []));
        cursor = listed.list_complete === false ? listed.cursor : null;
    } while (cursor);
    return keys;
}

async function getJson(kv, keyName) {
    const text = await kv.get(keyName, "text");
    if (!text) return null;
    try {
        return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (error) {
        return null;
    }
}

function actorCanSeeApproval(context, approval, actor) {
    return !approval.owner || approval.owner === actor.email || context.env.MOBILE_APPROVAL_ALLOW_ALL === "true";
}

function incrementStatus(statusCounts, status) {
    const key = normalizeString(status, 80) || "unknown";
    statusCounts[key] = (statusCounts[key] || 0) + 1;
}

function buildStages(definitions, statusCounts, total) {
    return definitions.map((definition) => {
        const count = definition.kind === "total"
            ? total
            : definition.statuses.reduce((sum, status) => sum + (statusCounts[status] || 0), 0);
        return {
            id: definition.id,
            label: definition.label,
            count,
            statuses: definition.statuses || []
        };
    });
}

async function summarizeYouTube(kv, context, actor) {
    const keys = await listKeys(kv, APPROVAL_PREFIX);
    const statusCounts = {};
    let total = 0;

    for (const key of keys) {
        const approval = await getJson(kv, key.name);
        if (!approval || approval.action_class !== "youtube_synthesis") continue;
        if (!actorCanSeeApproval(context, approval, actor)) continue;

        total += 1;
        incrementStatus(statusCounts, approval.status);
    }

    return {
        id: "youtube",
        label: "YouTube videos",
        total,
        stages: buildStages(YOUTUBE_STAGE_DEFINITIONS, statusCounts, total),
        rawStatuses: statusCounts
    };
}

async function summarizeInstagram(kv, context) {
    const prefix = configuredInstagramPrefix(context.env);
    const keys = await listKeys(kv, prefix);
    const statusCounts = {};
    let total = 0;

    for (const key of keys) {
        const record = await getJson(kv, key.name);
        if (!record) continue;

        total += 1;
        incrementStatus(statusCounts, record.status);
    }

    return {
        id: "instagram",
        label: "Instagram reels",
        total,
        stages: buildStages(INSTAGRAM_STAGE_DEFINITIONS, statusCounts, total),
        rawStatuses: statusCounts,
        queuePrefix: prefix
    };
}

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error || "Backend login is required." }, 401);

    const kv = getQueueKV(context.env);
    if (!kv) {
        return json({ error: "MOBILE_AUTH_KV binding is required for synthesis status counts." }, 503);
    }

    const [youtube, instagram] = await Promise.all([
        summarizeYouTube(kv, context, actor),
        summarizeInstagram(kv, context)
    ]);

    return json({
        ok: true,
        updatedAt: new Date().toISOString(),
        groups: [instagram, youtube]
    });
}
