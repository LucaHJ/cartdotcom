import { json, normalizeString, requireBackendSession } from "../../_lib/backend-auth.js";
import { approvalKey } from "../../_lib/mobile-auth.js";

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);
const JOB_PREFIX = "yt_";
const MAX_RECENT_JOBS = 12;

function fetchMetadataLooksSafe(request) {
    const site = request.headers.get("sec-fetch-site");
    if (!site) return true;
    return ["same-origin", "same-site", "none"].includes(site);
}

function getQueueKV(env) {
    return env.MOBILE_AUTH_KV || null;
}

async function sha256Hex(value) {
    const data = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeYouTubeUrl(value) {
    const raw = normalizeString(value, 800);
    if (!raw) throw new Error("YouTube URL is required.");

    let url;
    try {
        url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    } catch (error) {
        throw new Error("Enter a valid YouTube URL.");
    }

    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
        throw new Error("Only YouTube URLs are accepted.");
    }

    let videoId = "";
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (url.hostname.toLowerCase() === "youtu.be") {
        videoId = pathParts[0] || "";
    } else if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v") || "";
    } else if (["shorts", "live", "embed"].includes(pathParts[0])) {
        videoId = pathParts[1] || "";
    }

    if (videoId && !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
        throw new Error("The YouTube video id looks invalid.");
    }

    const normalizedUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : url.toString();
    return { normalizedUrl, videoId };
}

function buildPrompt({ url, jobId }) {
    return [
        "Run the unattended long-form YouTube video synthesis pipeline.",
        "",
        `YouTube URL: ${url}`,
        `Pipeline job id: ${jobId}`,
        "",
        "Success criteria:",
        "- Capture source metadata and transcript under `Vault/raw/videos/youtube/` with `metadata.md` as the parent file and `transcript/transcript.md` as the child transcript file.",
        "- Retain the YouTube link, metadata, transcript provenance, transcript chunks, and capture notes; do not retain downloaded video/audio media after analysis.",
        "- Perform expansion research for this video using web search and primary sources where possible.",
        "- Produce executive summary, chapter-by-chapter notes, claims and evidence extraction, concepts/entities, synthesis, action items, and project implications.",
        "- Update relevant wiki source/concept/entity/synthesis pages, `Vault/wiki/index.md`, `Vault/wiki/log.md`, and project development history where applicable.",
        "- Verify required files exist, transcript chunks were processed, index/log are current, and no temporary media files remain.",
        "",
        "Required local command:",
        "```powershell",
        `powershell -ExecutionPolicy Bypass -File C:\\Users\\User\\Desktop\\WAR-ROOM\\Tools\\YouTubeSynthesisPipeline\\Invoke-YouTubeSynthesis.ps1 -Url "${url}" -RunId "${jobId}"`,
        "```",
        "",
        "After the command completes, read the generated `codex-ingest-prompt.md` in the raw capture folder and execute it fully. If a dependency is missing, install it and continue. If captions are unavailable, use the audio transcription fallback. If the video is very long, process every transcript chunk sequentially before writing final synthesis."
    ].join("\n");
}

async function createApprovedYouTubeJob(context, input, actor) {
    const kv = getQueueKV(context.env);
    if (!kv) {
        return json({ error: "MOBILE_AUTH_KV binding is required for the synthesis queue." }, 503);
    }

    const { normalizedUrl, videoId } = normalizeYouTubeUrl(input.url);
    const jobId = `${JOB_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
    const prompt = buildPrompt({ url: normalizedUrl, jobId });
    const promptHash = await sha256Hex(JSON.stringify({ prompt, url: normalizedUrl }));
    const now = new Date().toISOString();
    const approval = {
        job_id: jobId,
        owner: actor.email,
        status: "approved",
        action_class: "youtube_synthesis",
        target: "WAR ROOM YouTube synthesis pipeline",
        prompt,
        attachments: [],
        prompt_hash: promptHash,
        success_criteria: [
            "Raw YouTube metadata and transcript capture exists under Vault/raw/videos/youtube/.",
            "Expansion research and brain synthesis are complete.",
            "Wiki index/log and relevant project history are updated.",
            "Downloaded media files are discarded after analysis."
        ].join(" "),
        risk_level: "medium",
        approval_level: "backend_authenticated_intake",
        approval_required: false,
        result_channel: "mobile_auth_kv",
        created_at: now,
        approved_at: now,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        backend_approval: {
            actor: actor.email,
            method: "backend-session",
            verified_at: now
        },
        youtube: {
            url: normalizedUrl,
            video_id: videoId
        }
    };

    await kv.put(approvalKey(jobId), JSON.stringify(approval), { expirationTtl: 30 * 24 * 60 * 60 });
    return json({
        ok: true,
        jobId,
        promptHash,
        status: approval.status,
        url: normalizedUrl,
        videoId,
        queueBackend: "mobile_auth_kv",
        approvalRequired: false
    });
}

async function listRecentYouTubeJobs(context, actor) {
    const kv = getQueueKV(context.env);
    if (!kv) {
        return json({ error: "MOBILE_AUTH_KV binding is required for the synthesis queue." }, 503);
    }

    const listed = await kv.list({ prefix: "mobile-auth:approval:" });
    const jobs = [];
    for (const key of listed.keys || []) {
        const approval = await kv.get(key.name, "json");
        if (!approval || approval.action_class !== "youtube_synthesis") continue;
        if (approval.owner && approval.owner !== actor.email && context.env.MOBILE_APPROVAL_ALLOW_ALL !== "true") continue;
        jobs.push({
            jobId: approval.job_id,
            status: approval.status,
            url: approval.youtube?.url || "",
            videoId: approval.youtube?.video_id || "",
            createdAt: approval.created_at || "",
            handledAt: approval.handled_at || "",
            note: approval.handling_note || ""
        });
    }

    jobs.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    return json({ ok: true, jobs: jobs.slice(0, MAX_RECENT_JOBS) });
}

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error || "Backend login is required." }, 401);

    return listRecentYouTubeJobs(context, actor);
}

export async function onRequestPost(context) {
    if (!fetchMetadataLooksSafe(context.request)) {
        return json({ error: "Cross-site synthesis submissions are blocked." }, 403);
    }

    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error || "Backend login is required." }, 401);

    const input = await context.request.json().catch(() => null);
    if (!input) return json({ error: "JSON body is required." }, 400);

    try {
        return await createApprovedYouTubeJob(context, input, actor);
    } catch (error) {
        return json({ error: error.message || "YouTube synthesis job could not be created." }, 400);
    }
}
