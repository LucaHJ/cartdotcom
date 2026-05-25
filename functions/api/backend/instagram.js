import { json, normalizeString, requireBackendSession } from "../../_lib/backend-auth.js";

const DEFAULT_INSTAGRAM_PREFIX = "instagram:intake:";
const DEFAULT_DIAGNOSTIC_PREFIX = "instagram:webhook-diagnostic:";
const CONFIRM_STATUS = "confirm_existence";
const CONFIRMABLE_STATUSES = new Set(["confirm_existence", "failed", "retry_queued"]);

function fetchMetadataLooksSafe(request) {
    const site = request.headers.get("sec-fetch-site");
    if (!site) return true;
    return ["same-origin", "same-site", "none"].includes(site);
}

function getQueueKV(env) {
    return env.MOBILE_AUTH_KV || null;
}

function configuredInstagramPrefix(env) {
    return normalizeString(env.INSTAGRAM_INTAKE_KV_PREFIX, 80) || DEFAULT_INSTAGRAM_PREFIX;
}

function configuredDiagnosticPrefix(env) {
    return normalizeString(env.INSTAGRAM_WEBHOOK_DIAGNOSTIC_PREFIX, 120) || DEFAULT_DIAGNOSTIC_PREFIX;
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

function primaryInstagramUrl(record) {
    const values = [
        ...collectStringValues(record?.urls || []),
        ...collectStringValues(record?.attachments || []),
        ...collectStringValues(record?.raw_string_samples || []),
        record?.text,
        record?.note
    ];
    const instagramPattern = /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv|share\/reel|share\/p)\/[^\s"'`<>)]+/i;
    for (const value of values) {
        const match = String(value || "").match(instagramPattern);
        if (match) return match[0].replace(/[),.;]+$/, "");
    }
    return "";
}

function recordTitle(record) {
    for (const attachment of record?.attachments || []) {
        const title = normalizeString(attachment?.title, 240);
        if (title) return title;
    }
    return normalizeString(record?.text || record?.note || "", 240);
}

function summarizeRecord(record) {
    return {
        id: normalizeString(record?.id, 120),
        status: normalizeString(record?.status, 80),
        url: primaryInstagramUrl(record),
        title: recordTitle(record),
        receivedAt: normalizeString(record?.received_at, 80),
        messageTimestamp: record?.message_timestamp || "",
        note: normalizeString(record?.handling_note || record?.note || "", 500),
        requeuedAt: normalizeString(record?.requeued_at, 80),
        requeuedFromStatus: normalizeString(record?.requeued_from_status, 80)
    };
}

function summarizeDiagnostic(record) {
    return {
        id: normalizeString(record?.id, 160),
        receivedAt: normalizeString(record?.received_at, 80),
        status: normalizeString(record?.status, 80),
        signaturePresent: Boolean(record?.signature_present),
        signatureVerified: Boolean(record?.signature_verified),
        object: normalizeString(record?.object, 80),
        eventCount: Number(record?.event_count) || 0,
        storedCount: Number(record?.stored_count) || 0,
        readyCount: Number(record?.ready_count) || 0,
        bodyBytes: Number(record?.body_bytes) || 0,
        error: normalizeString(record?.error, 300)
    };
}

function removeQueueMetadata(record) {
    delete record.handled_at;
    delete record.processing_started_at;
    delete record.processing_status_before_running;
    delete record.handling_log;
}

function updateRecordDecision(record, decision, actor) {
    const now = new Date().toISOString();
    const previousStatus = normalizeString(record.status, 80) || "unknown";
    if (decision === "exists") {
        removeQueueMetadata(record);
        record.status = "ready";
        record.requeued_at = now;
        record.requeued_from_status = previousStatus;
        record.handled_by = "cartdotcom-instagram-confirm-existence";
        record.handling_note = `Existence confirmed by ${actor.email || "backend user"}; queued for retry.`;
        return record;
    }
    if (decision === "removed") {
        record.status = "removed";
        record.handled_at = now;
        record.handled_by = "cartdotcom-instagram-confirm-existence";
        record.handling_note = `Marked removed by ${actor.email || "backend user"} after existence check.`;
        return record;
    }
    throw new Error("Decision must be exists or removed.");
}

async function listConfirmExistence(context) {
    const kv = getQueueKV(context.env);
    if (!kv) return json({ error: "MOBILE_AUTH_KV binding is required for Instagram intake." }, 503);

    const prefix = configuredInstagramPrefix(context.env);
    const keys = await listKeys(kv, prefix);
    const diagnosticPrefix = configuredDiagnosticPrefix(context.env);
    const diagnosticKeys = await listKeys(kv, diagnosticPrefix);
    const records = [];
    for (const key of keys) {
        const record = await getJson(kv, key.name);
        if (!record || record.status !== CONFIRM_STATUS) continue;
        records.push(summarizeRecord(record));
    }
    records.sort((left, right) => String(left.receivedAt).localeCompare(String(right.receivedAt)));

    const diagnostics = [];
    for (const key of diagnosticKeys) {
        const record = await getJson(kv, key.name);
        if (!record) continue;
        diagnostics.push(summarizeDiagnostic(record));
    }
    diagnostics.sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)));

    return json({
        ok: true,
        updatedAt: new Date().toISOString(),
        queue: "confirm_existence",
        prefix,
        records,
        diagnostics: diagnostics.slice(0, 20)
    });
}

async function decideConfirmExistence(context, input, actor) {
    const kv = getQueueKV(context.env);
    if (!kv) return json({ error: "MOBILE_AUTH_KV binding is required for Instagram intake." }, 503);

    const id = normalizeString(input?.id || input?.jobId || input?.job_id, 120);
    const decision = normalizeString(input?.decision, 40).toLowerCase();
    if (!/^ig_[a-f0-9]+$/i.test(id)) {
        return json({ error: "A valid Instagram intake id is required." }, 400);
    }
    if (!["exists", "removed"].includes(decision)) {
        return json({ error: "Decision must be exists or removed." }, 400);
    }

    const keyName = `${configuredInstagramPrefix(context.env)}${id}`;
    const record = await getJson(kv, keyName);
    if (!record) return json({ error: "Instagram intake record was not found." }, 404);
    if (!CONFIRMABLE_STATUSES.has(record.status)) {
        return json({ error: `Record ${id} is ${record.status}; only confirm-existence records can be decided here.` }, 409);
    }

    const nextRecord = updateRecordDecision(record, decision, actor);
    await kv.put(keyName, JSON.stringify(nextRecord), { expirationTtl: 30 * 24 * 60 * 60 });
    return json({
        ok: true,
        decision,
        record: summarizeRecord(nextRecord)
    });
}

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error || "Backend login is required." }, 401);

    return listConfirmExistence(context);
}

export async function onRequestPost(context) {
    if (!fetchMetadataLooksSafe(context.request)) {
        return json({ error: "Cross-site Instagram decisions are blocked." }, 403);
    }

    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error || "Backend login is required." }, 401);

    const input = await context.request.json().catch(() => null);
    if (!input) return json({ error: "JSON body is required." }, 400);

    try {
        return await decideConfirmExistence(context, input, actor);
    } catch (error) {
        return json({ error: error.message || "Instagram decision failed." }, 400);
    }
}
