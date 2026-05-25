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

function addStatusIdentity(statusSets, status, submissionKey) {
    const statusKey = normalizeString(status, 80) || "unknown";
    if (!statusSets[statusKey]) statusSets[statusKey] = new Set();
    statusSets[statusKey].add(submissionKey);
}

function statusSetCounts(statusSets) {
    const counts = {};
    for (const [status, identities] of Object.entries(statusSets)) {
        counts[status] = identities.size;
    }
    return counts;
}

function collectStringValues(value, output = [], depth = 0) {
    if (output.length >= 80 || depth > 8 || value == null) return output;
    if (typeof value === "string" || typeof value === "number") {
        const normalized = normalizeString(value, 1200);
        if (normalized && !output.includes(normalized)) output.push(normalized);
        return output;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectStringValues(item, output, depth + 1);
            if (output.length >= 80) break;
        }
        return output;
    }
    if (typeof value === "object") {
        for (const item of Object.values(value)) {
            collectStringValues(item, output, depth + 1);
            if (output.length >= 80) break;
        }
    }
    return output;
}

function normalizedUrl(value) {
    const raw = normalizeString(value, 1000);
    if (!raw) return "";
    try {
        const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
        url.hash = "";
        url.search = "";
        url.hostname = url.hostname.toLowerCase();
        url.pathname = url.pathname.replace(/\/+$/, "");
        return url.toString();
    } catch (error) {
        return raw.toLowerCase();
    }
}

function youtubeIdFromUrl(value) {
    try {
        const url = new URL(String(value || "").includes("://") ? value : `https://${value}`);
        const host = url.hostname.toLowerCase();
        const pathParts = url.pathname.split("/").filter(Boolean);
        if (host === "youtu.be") return pathParts[0] || "";
        if (host.endsWith("youtube.com")) {
            if (url.pathname === "/watch") return url.searchParams.get("v") || "";
            if (["shorts", "live", "embed"].includes(pathParts[0])) return pathParts[1] || "";
        }
    } catch (error) {
        return "";
    }
    return "";
}

function youtubeSubmissionKey(approval) {
    const video = approval?.youtube || {};
    const videoKey = normalizeString(video.video_key, 240);
    if (videoKey) return `youtube:${videoKey}`;

    const videoId = normalizeString(video.video_id, 80) || youtubeIdFromUrl(video.url);
    if (videoId) return `youtube:id:${videoId}`;

    const urlKey = normalizedUrl(video.url);
    if (urlKey) return `youtube:url:${urlKey}`;

    return `youtube:job:${normalizeString(approval?.job_id, 120)}`;
}

function instagramPermalinkKey(value) {
    const raw = normalizeString(value, 1200);
    if (!raw) return "";

    let url;
    try {
        url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch (error) {
        return "";
    }

    const host = url.hostname.toLowerCase();
    if (!(host === "instagram.com" || host.endsWith(".instagram.com"))) return "";

    const parts = url.pathname.split("/").filter(Boolean);
    let kind = parts[0] || "";
    let code = parts[1] || "";
    if (kind === "share" && ["reel", "reels", "p"].includes(parts[1])) {
        kind = parts[1];
        code = parts[2] || "";
    }
    if (!["reel", "reels", "p", "tv"].includes(kind) || !code) return "";
    if (kind === "reels") kind = "reel";

    return `instagram:${kind}:${code}`;
}

function instagramAssetKey(record) {
    const values = collectStringValues(record);
    for (const value of values) {
        const match = String(value).match(/[?&]asset_id=(\d{8,})/i);
        if (match) return `instagram:asset:${match[1]}`;
    }
    for (const value of values) {
        if (/^\d{8,}$/.test(String(value))) return `instagram:asset:${value}`;
    }
    return "";
}

function instagramSubmissionKey(record) {
    const values = [
        ...collectStringValues(record?.urls || []),
        normalizeString(record?.canonical_url, 1000),
        normalizeString(record?.source_url, 1000),
        ...collectStringValues(record?.attachments || []),
        ...collectStringValues(record?.raw_string_samples || []),
        normalizeString(record?.referral, 1000),
        normalizeString(record?.postback, 1000),
        normalizeString(record?.text, 2000)
    ].filter(Boolean);

    for (const value of values) {
        const key = instagramPermalinkKey(value);
        if (key) return key;
    }

    return instagramAssetKey(record) || `instagram:intake:${normalizeString(record?.id, 120)}`;
}

function suppressResolvedFailures(items, keyForItem) {
    const handledKeys = new Set(
        items
            .filter((item) => item.record.status === "handled")
            .map((item) => keyForItem(item.record))
            .filter(Boolean)
    );

    return items.map((item) => ({
        ...item,
        submissionKey: keyForItem(item.record),
        effectiveStatus: item.record.status === "failed" && handledKeys.has(keyForItem(item.record))
            ? "failed_resolved"
            : item.record.status
    }));
}

function summarizeEffectiveStatuses(effectiveRecords) {
    const statusSets = {};
    const totalIdentities = new Set();
    const resolvedFailedIdentities = new Set();

    for (const item of effectiveRecords) {
        if (!item.submissionKey) continue;
        totalIdentities.add(item.submissionKey);
        addStatusIdentity(statusSets, item.effectiveStatus, item.submissionKey);
        if (item.effectiveStatus === "failed_resolved") {
            resolvedFailedIdentities.add(item.submissionKey);
        }
    }

    return {
        total: totalIdentities.size,
        statusCounts: statusSetCounts(statusSets),
        resolvedFailed: resolvedFailedIdentities.size
    };
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
    const records = [];

    for (const key of keys) {
        const approval = await getJson(kv, key.name);
        if (!approval || approval.action_class !== "youtube_synthesis") continue;
        if (!actorCanSeeApproval(context, approval, actor)) continue;

        records.push({ record: approval });
    }

    const effectiveRecords = suppressResolvedFailures(records, youtubeSubmissionKey);
    const { total, statusCounts, resolvedFailed } = summarizeEffectiveStatuses(effectiveRecords);

    return {
        id: "youtube",
        label: "YouTube videos",
        total,
        stages: buildStages(YOUTUBE_STAGE_DEFINITIONS, statusCounts, total),
        rawStatuses: statusCounts,
        resolvedFailed
    };
}

async function summarizeInstagram(kv, context) {
    const prefix = configuredInstagramPrefix(context.env);
    const keys = await listKeys(kv, prefix);
    const records = [];

    for (const key of keys) {
        const record = await getJson(kv, key.name);
        if (!record) continue;

        records.push({ record });
    }

    const effectiveRecords = suppressResolvedFailures(records, instagramSubmissionKey);
    const { total, statusCounts, resolvedFailed } = summarizeEffectiveStatuses(effectiveRecords);

    return {
        id: "instagram",
        label: "Instagram reels",
        total,
        stages: buildStages(INSTAGRAM_STAGE_DEFINITIONS, statusCounts, total),
        rawStatuses: statusCounts,
        resolvedFailed,
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
