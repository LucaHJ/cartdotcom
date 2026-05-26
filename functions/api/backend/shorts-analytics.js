import { json, requireBackendSession } from "../../_lib/backend-auth.js";
import { getPage, getSecondBrainKV, missingSecondBrainKV } from "../../_lib/second-brain.js";

const PERFORMANCE_REVIEW_PATH = "10-Projects/Hands-Free-Shortform-Content/Stories/performance-review.md";
const FULL_YPP_SHORTS_VIEWS_TARGET = 10000000;
const FULL_YPP_SUBSCRIBERS_TARGET = 1000;
const EARLY_YPP_SHORTS_VIEWS_TARGET = 3000000;
const EARLY_YPP_SUBSCRIBERS_TARGET = 500;
const EARLY_YPP_UPLOADS_TARGET = 3;
const YOUTUBE_VIDEOS_API = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_API_BATCH_SIZE = 50;

function cleanCell(value) {
    return String(value || "")
        .replace(/^\s*`|`\s*$/g, "")
        .replace(/\\\|/g, "|")
        .trim();
}

function parseNumber(value) {
    const normalized = cleanCell(value).replace(/,/g, "").replace(/%/g, "");
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
}

function splitMarkdownRow(line) {
    return String(line || "")
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map(cleanCell);
}

function extractPerformanceRows(markdown) {
    const rows = [];
    let inLog = false;
    for (const line of String(markdown || "").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (/^##\s+Video Performance Log\s*$/i.test(trimmed)) {
            inLog = true;
            continue;
        }
        if (inLog && /^##\s+/.test(trimmed)) break;
        if (!inLog || !trimmed.startsWith("|")) continue;
        if (/^\|\s*-+/.test(trimmed) || /Video ID/i.test(trimmed)) continue;

        const cells = splitMarkdownRow(trimmed);
        if (cells.length < 12) continue;
        const videoId = cleanCell(cells[1]);
        if (!videoId || /^_?none_?$/i.test(videoId) || /^_?pending_?$/i.test(videoId)) continue;

        rows.push({
            date: cleanCell(cells[0]),
            video_id: videoId,
            story_id: cleanCell(cells[2]),
            tts_gender: cleanCell(cells[3]).toLowerCase(),
            subject_tags: cleanCell(cells[4]).split(",").map((tag) => tag.trim()).filter(Boolean),
            views: parseNumber(cells[5]),
            avg_view_duration: parseNumber(cells[6]),
            retention: parseNumber(cells[7]),
            comments: parseNumber(cells[8]),
            likes: parseNumber(cells[9]),
            shares: parseNumber(cells[10]),
            notes: cleanCell(cells.slice(11).join("|"))
        });
    }
    return rows;
}

function isActivePerformanceRow(row) {
    return !/\bremoved\b|\btaken down\b/i.test(row.notes);
}

function uniqueVideoIds(rows) {
    return [...new Set(
        rows
            .filter(isActivePerformanceRow)
            .map((row) => row.video_id)
            .filter(Boolean)
    )];
}

function parseYoutubeCount(value) {
    const count = Number(value || 0);
    return Number.isFinite(count) ? count : 0;
}

async function fetchYoutubeStatistics(videoIds, apiKey) {
    if (!apiKey || !videoIds.length) return new Map();

    const stats = new Map();
    for (let index = 0; index < videoIds.length; index += YOUTUBE_API_BATCH_SIZE) {
        const batch = videoIds.slice(index, index + YOUTUBE_API_BATCH_SIZE);
        const url = new URL(YOUTUBE_VIDEOS_API);
        url.searchParams.set("part", "statistics");
        url.searchParams.set("id", batch.join(","));
        url.searchParams.set("key", apiKey);

        const response = await fetch(url, { headers: { accept: "application/json" } });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(payload?.error?.message || "YouTube video statistics could not be loaded.");
        }

        for (const item of payload?.items || []) {
            stats.set(item.id, {
                views: parseYoutubeCount(item.statistics?.viewCount),
                likes: parseYoutubeCount(item.statistics?.likeCount),
                comments: parseYoutubeCount(item.statistics?.commentCount)
            });
        }
    }
    return stats;
}

function mergeYoutubeStatistics(rows, stats) {
    if (!stats?.size) return rows;
    return rows.map((row) => {
        const videoStats = stats.get(row.video_id);
        if (!videoStats) return row;
        return {
            ...row,
            views: videoStats.views,
            likes: videoStats.likes,
            comments: videoStats.comments,
            stats_source: "youtube_data_api"
        };
    });
}

function summarizeRows(rows) {
    const activeRows = rows.filter(isActivePerformanceRow);
    const totalViews = activeRows.reduce((total, row) => total + row.views, 0);
    const totalLikes = activeRows.reduce((total, row) => total + row.likes, 0);
    const totalComments = activeRows.reduce((total, row) => total + row.comments, 0);
    const totalShares = activeRows.reduce((total, row) => total + row.shares, 0);
    const monetizationProgress = totalViews / FULL_YPP_SHORTS_VIEWS_TARGET;
    const earlyAccessProgress = Math.min(
        totalViews / EARLY_YPP_SHORTS_VIEWS_TARGET,
        activeRows.length / EARLY_YPP_UPLOADS_TARGET
    );

    return {
        totals: {
            views: totalViews,
            likes: totalLikes,
            comments: totalComments,
            shares: totalShares,
            videos_published: activeRows.length,
            subscribers: null
        },
        monetization: {
            full_ypp: {
                subscribers_required: FULL_YPP_SUBSCRIBERS_TARGET,
                shorts_views_required: FULL_YPP_SHORTS_VIEWS_TARGET,
                shorts_views_window_days: 90,
                shorts_views_progress: monetizationProgress,
                subscribers_progress: null
            },
            early_access: {
                subscribers_required: EARLY_YPP_SUBSCRIBERS_TARGET,
                public_uploads_required: EARLY_YPP_UPLOADS_TARGET,
                shorts_views_required: EARLY_YPP_SHORTS_VIEWS_TARGET,
                shorts_views_window_days: 90,
                progress: earlyAccessProgress
            }
        },
        rows: activeRows
    };
}

export async function onRequestGet(context) {
    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const kv = getSecondBrainKV(context.env);
    if (!kv) return missingSecondBrainKV();

    let page;
    try {
        page = await getPage(kv, PERFORMANCE_REVIEW_PATH);
    } catch (error) {
        return json({ error: error.message || "Shorts analytics source could not be loaded." }, 400);
    }

    if (!page) {
        return json({
            ok: true,
            source: PERFORMANCE_REVIEW_PATH,
            source_status: "missing",
            stats_source: "performance_review",
            stats_error: "",
            live_stats_video_count: 0,
            ...summarizeRows([])
        });
    }

    let rows = extractPerformanceRows(page.content || "");
    const apiKey = context.env.YOUTUBE_API_KEY || context.env.SHORTS_YOUTUBE_API_KEY || "";
    let statsSource = apiKey ? "youtube_data_api" : "performance_review";
    let statsError = "";
    let liveStatsVideoCount = 0;

    if (apiKey) {
        try {
            const stats = await fetchYoutubeStatistics(uniqueVideoIds(rows), apiKey);
            liveStatsVideoCount = stats.size;
            rows = mergeYoutubeStatistics(rows, stats);
        } catch (error) {
            statsSource = "performance_review";
            statsError = error.message || "YouTube video statistics could not be loaded.";
        }
    }

    return json({
        ok: true,
        source: PERFORMANCE_REVIEW_PATH,
        source_status: "loaded",
        stats_source: statsSource,
        stats_error: statsError,
        live_stats_video_count: liveStatsVideoCount,
        updated_at: page.metadata?.updated_at || "",
        ...summarizeRows(rows)
    }, 200, { "cache-control": "private, max-age=300" });
}
