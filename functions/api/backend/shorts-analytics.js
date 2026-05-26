import { json, requireBackendSession } from "../../_lib/backend-auth.js";
import { getManifest, getPage, getSecondBrainKV, missingSecondBrainKV } from "../../_lib/second-brain.js";

const PERFORMANCE_REVIEW_PATH = "10-Projects/Hands-Free-Shortform-Content/Stories/performance-review.md";
const STORIES_PATH_PREFIX = "10-Projects/Hands-Free-Shortform-Content/Stories/";
const SNAPSHOT_PREFIX = "shorts:performance-snapshot:";
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

function normalizeTag(value) {
    return cleanCell(value).replace(/^#/, "").toLowerCase();
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
            subject_tags: cleanCell(cells[4]).split(",").map(normalizeTag).filter(Boolean),
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
    return !/\bremoved\b|\btaken down\b|\bdeleted\b|\bprivate\b/i.test(row.notes);
}

function isLearningEligibleRow(row) {
    return isActivePerformanceRow(row) && !/\bflawed\b|\bsuperseded\b|\brejected\b|do not use for performance learning/i.test(row.notes);
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

function extractFrontmatter(markdown) {
    const match = String(markdown || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    return match ? match[1] : "";
}

function parseQuotedValue(value) {
    return cleanCell(value).replace(/^["']|["']$/g, "");
}

function parseFrontmatterValue(frontmatter, key) {
    const pattern = new RegExp(`^${key}:\\s*(.+)$`, "mi");
    const match = String(frontmatter || "").match(pattern);
    return match ? parseQuotedValue(match[1]) : "";
}

function parseFrontmatterArray(frontmatter, key) {
    const inline = String(frontmatter || "").match(new RegExp(`^${key}:\\s*\\[(.*?)\\]\\s*$`, "mi"));
    if (inline) {
        return inline[1]
            .split(",")
            .map((item) => normalizeTag(parseQuotedValue(item)))
            .filter(Boolean);
    }

    const block = String(frontmatter || "").match(new RegExp(`^${key}:\\s*\\r?\\n((?:\\s+-\\s+.+\\r?\\n?)+)`, "mi"));
    if (!block) return [];
    return block[1]
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s+-\s+/, ""))
        .map((item) => normalizeTag(parseQuotedValue(item)))
        .filter(Boolean);
}

function parseStoryMetadata(path, markdown) {
    const frontmatter = extractFrontmatter(markdown);
    const storyIdFromPath = String(path || "").match(/\/(RS-[A-Z0-9]+)-/i)?.[1] || "";
    const storyId = parseFrontmatterValue(frontmatter, "story_id") || storyIdFromPath;
    if (!storyId) return null;

    return {
        story_id: storyId,
        path,
        subreddit: parseFrontmatterValue(frontmatter, "subreddit"),
        title: parseFrontmatterValue(frontmatter, "title"),
        tts_gender: parseFrontmatterValue(frontmatter, "tts_gender").toLowerCase(),
        subject_tags: parseFrontmatterArray(frontmatter, "subject_tags"),
        recommended_parts: parseNumber(parseFrontmatterValue(frontmatter, "recommended_parts")),
        splitability_score: parseNumber(parseFrontmatterValue(frontmatter, "splitability_score"))
    };
}

async function storyPathsForIds(kv, storyIds) {
    const needed = new Set(storyIds.filter(Boolean));
    if (!needed.size) return new Map();

    const manifest = await getManifest(kv).catch(() => null);
    const pages = Array.isArray(manifest?.pages) ? manifest.pages : [];
    const paths = new Map();
    for (const page of pages) {
        const path = String(page.path || "");
        if (!path.startsWith(STORIES_PATH_PREFIX) || !path.endsWith(".md")) continue;
        const match = path.slice(STORIES_PATH_PREFIX.length).match(/^(RS-[A-Z0-9]+)-/i);
        const storyId = match?.[1] || "";
        if (needed.has(storyId) && !paths.has(storyId)) paths.set(storyId, path);
    }
    return paths;
}

async function loadStoryMetadata(kv, rows) {
    const storyIds = [...new Set(rows.map((row) => row.story_id).filter(Boolean))];
    const paths = await storyPathsForIds(kv, storyIds);
    const metadata = new Map();
    for (const [storyId, path] of paths) {
        const page = await getPage(kv, path).catch(() => null);
        const parsed = parseStoryMetadata(path, page?.content || "");
        if (parsed) metadata.set(storyId, parsed);
    }
    return metadata;
}

function enrichRowsWithStoryMetadata(rows, metadata) {
    return rows.map((row) => {
        const story = metadata.get(row.story_id) || {};
        const subjectTags = row.subject_tags?.length ? row.subject_tags : story.subject_tags || [];
        const ttsGender = row.tts_gender || story.tts_gender || "unknown";
        return {
            ...row,
            tts_gender: ttsGender,
            subject_tags: subjectTags,
            subreddit: story.subreddit || "unknown",
            story_title: story.title || "",
            story_tts_gender: story.tts_gender || "",
            recommended_parts: story.recommended_parts || 0,
            splitability_score: story.splitability_score || 0,
            learning_eligible: isLearningEligibleRow({ ...row, tts_gender: ttsGender, subject_tags: subjectTags })
        };
    });
}

function rowForClient(row) {
    return {
        date: row.date,
        video_id: row.video_id,
        video_url: `https://youtube.com/shorts/${row.video_id}`,
        story_id: row.story_id,
        story_title: row.story_title || "",
        subreddit: row.subreddit || "unknown",
        tts_gender: row.tts_gender || "unknown",
        subject_tags: row.subject_tags || [],
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        retention: row.retention,
        avg_view_duration: row.avg_view_duration,
        learning_eligible: Boolean(row.learning_eligible),
        notes: row.notes
    };
}

function topRows(rows, metric) {
    return [...rows]
        .sort((left, right) => (Number(right[metric]) || 0) - (Number(left[metric]) || 0))
        .slice(0, 10)
        .map(rowForClient);
}

function scoreSegment(segment) {
    const avgViews = segment.videos ? segment.views / segment.videos : 0;
    const likesPerView = segment.views ? segment.likes / segment.views : 0;
    const commentsPerView = segment.views ? segment.comments / segment.views : 0;
    return avgViews + (likesPerView * 1000) + (commentsPerView * 1500);
}

function summarizeSegmentRows(rows, keySelector) {
    const segments = new Map();
    for (const row of rows) {
        const keys = keySelector(row).map(cleanCell).filter(Boolean);
        for (const key of keys.length ? keys : ["unknown"]) {
            if (!segments.has(key)) {
                segments.set(key, {
                    key,
                    videos: 0,
                    views: 0,
                    likes: 0,
                    comments: 0,
                    shares: 0,
                    story_ids: new Set()
                });
            }
            const segment = segments.get(key);
            segment.videos += 1;
            segment.views += Number(row.views) || 0;
            segment.likes += Number(row.likes) || 0;
            segment.comments += Number(row.comments) || 0;
            segment.shares += Number(row.shares) || 0;
            if (row.story_id) segment.story_ids.add(row.story_id);
        }
    }

    return [...segments.values()].map((segment) => {
        const output = {
            key: segment.key,
            videos: segment.videos,
            stories: segment.story_ids.size,
            views: segment.views,
            likes: segment.likes,
            comments: segment.comments,
            shares: segment.shares,
            avg_views: segment.videos ? segment.views / segment.videos : 0,
            likes_per_1000_views: segment.views ? (segment.likes / segment.views) * 1000 : 0,
            comments_per_1000_views: segment.views ? (segment.comments / segment.views) * 1000 : 0
        };
        output.score = scoreSegment(output);
        output.confidence = segment.videos >= 3 && segment.views >= 1000 ? "directional" : "low";
        return output;
    }).sort((left, right) => right.score - left.score || right.views - left.views || left.key.localeCompare(right.key));
}

function themesForRow(row) {
    const tags = new Set(row.subject_tags || []);
    const themes = new Set();
    const addIf = (theme, values) => {
        if (values.some((tag) => tags.has(tag))) themes.add(theme);
    };

    addIf("relationship conflict", ["relationship", "wedding", "divorce", "breakup", "betrayal"]);
    addIf("family pressure", ["family", "parenting", "sibling", "parents", "mother", "father"]);
    addIf("money stakes", ["money", "debt", "inheritance", "rent", "savings"]);
    addIf("judgement bait", ["aita", "aitah", "wibta", "wibtah"]);
    addIf("workplace tension", ["workplace", "job", "career"]);
    addIf("revenge/update payoff", ["revenge", "update", "consequence"]);
    for (const tag of tags) {
        if (!themes.size) themes.add(tag);
    }
    return [...themes];
}

function buildSegments(rows) {
    const learningRows = rows.filter((row) => row.learning_eligible);
    return {
        source_video_count: learningRows.length,
        excluded_video_count: rows.filter(isActivePerformanceRow).length - learningRows.length,
        subreddits: summarizeSegmentRows(learningRows, (row) => [row.subreddit || "unknown"]).slice(0, 12),
        voice_genders: summarizeSegmentRows(learningRows, (row) => [row.tts_gender || "unknown"]).slice(0, 8),
        tags: summarizeSegmentRows(learningRows, (row) => row.subject_tags || []).slice(0, 18),
        themes: summarizeSegmentRows(learningRows, themesForRow).slice(0, 12)
    };
}

function buildDecisionGuidance(rows, segments) {
    const learningRows = rows.filter((row) => row.learning_eligible);
    const eligibleViews = learningRows.reduce((total, row) => total + row.views, 0);
    const confidentSegments = [
        ...segments.subreddits,
        ...segments.voice_genders,
        ...segments.tags,
        ...segments.themes
    ].filter((segment) => segment.confidence !== "low");
    const enoughCoverage = learningRows.length >= 15 && confidentSegments.length >= 3 && eligibleViews >= 5000;
    const strategy = enoughCoverage ? "mixed_exploit_and_explore" : "explore_broadly";

    return {
        strategy,
        learning_video_count: learningRows.length,
        learning_view_count: eligibleViews,
        minimum_before_strong_optimization: {
            videos: 15,
            views: 5000,
            videos_per_segment: 3
        },
        guidance: enoughCoverage
            ? "Use a mixed strategy: bias selection toward proven tags/subreddits/themes while reserving enough slots for new topics so the channel does not become repetitive."
            : "Keep testing a wide range of subreddits, story themes, and POV genders. Current data is too thin for strong optimization.",
        voice_rule: "TTS gender must match the story POV. If one voice gender performs better, select more matching-POV stories instead of mismatching narration."
    };
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

async function listSnapshotKeys(kv) {
    if (!kv) return [];
    const keys = [];
    let cursor;
    do {
        const options = { prefix: SNAPSHOT_PREFIX };
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

async function listSnapshots(kv) {
    const keys = await listSnapshotKeys(kv);
    const snapshots = [];
    for (const key of keys) {
        const snapshot = await getJson(kv, key.name);
        if (snapshot) snapshots.push(snapshot);
    }
    return snapshots
        .sort((left, right) => String(left.captured_at || left.id).localeCompare(String(right.captured_at || right.id)))
        .slice(-500);
}

function localDateId(date, timeZone = "Australia/Brisbane") {
    try {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).format(date);
    } catch (error) {
        return date.toISOString().slice(0, 10);
    }
}

function snapshotFromAnalytics(analytics, env = {}) {
    const now = new Date();
    const totals = analytics?.totals || {};
    const full = analytics?.monetization?.full_ypp || {};
    return {
        id: localDateId(now, env.SHORTS_ANALYTICS_TIME_ZONE || "Australia/Brisbane"),
        captured_at: now.toISOString(),
        views: Number(totals.views) || 0,
        likes: Number(totals.likes) || 0,
        comments: Number(totals.comments) || 0,
        shares: Number(totals.shares) || 0,
        subscribers: totals.subscribers == null ? null : Number(totals.subscribers) || 0,
        videos_published: Number(totals.videos_published) || 0,
        goal_progress: Number(full.shorts_views_progress) || 0,
        stats_source: analytics?.stats_source || "unknown",
        live_stats_video_count: Number(analytics?.live_stats_video_count) || 0
    };
}

async function buildShortsAnalytics(context, options = {}) {
    const { includeSnapshots = true } = options;
    const kv = getSecondBrainKV(context.env);
    if (!kv) return { response: missingSecondBrainKV() };

    const actor = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!actor.ok) return { response: json({ error: actor.error }, 401) };

    let page;
    try {
        page = await getPage(kv, PERFORMANCE_REVIEW_PATH);
    } catch (error) {
        return { response: json({ error: error.message || "Shorts analytics source could not be loaded." }, 400) };
    }

    if (!page) {
        const payload = {
            ok: true,
            source: PERFORMANCE_REVIEW_PATH,
            source_status: "missing",
            stats_source: "performance_review",
            stats_error: "",
            live_stats_video_count: 0,
            rankings: { views: [], likes: [], comments: [] },
            segments: buildSegments([]),
            decision_guidance: buildDecisionGuidance([], buildSegments([])),
            snapshots: includeSnapshots ? await listSnapshots(context.env.MOBILE_AUTH_KV || null) : [],
            ...summarizeRows([])
        };
        return { actor, payload };
    }

    let rows = extractPerformanceRows(page.content || "");
    const storyMetadata = await loadStoryMetadata(kv, rows);
    rows = enrichRowsWithStoryMetadata(rows, storyMetadata);
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

    rows = enrichRowsWithStoryMetadata(rows, storyMetadata);
    const summary = summarizeRows(rows);
    const activeRows = summary.rows;
    const segments = buildSegments(rows);
    const payload = {
        ok: true,
        source: PERFORMANCE_REVIEW_PATH,
        source_status: "loaded",
        stats_source: statsSource,
        stats_error: statsError,
        live_stats_video_count: liveStatsVideoCount,
        updated_at: page.metadata?.updated_at || "",
        rankings: {
            views: topRows(activeRows, "views"),
            likes: topRows(activeRows, "likes"),
            comments: topRows(activeRows, "comments")
        },
        segments,
        decision_guidance: buildDecisionGuidance(rows, segments),
        snapshots: includeSnapshots ? await listSnapshots(context.env.MOBILE_AUTH_KV || null) : [],
        ...summary,
        rows: activeRows.map(rowForClient)
    };
    return { actor, payload };
}

function fetchMetadataLooksSafe(request) {
    const site = request.headers.get("sec-fetch-site");
    if (!site) return true;
    return ["same-origin", "same-site", "none"].includes(site);
}

export async function onRequestGet(context) {
    const result = await buildShortsAnalytics(context);
    if (result.response) return result.response;
    return json(result.payload, 200, { "cache-control": "private, max-age=300" });
}

export async function onRequestPost(context) {
    if (!fetchMetadataLooksSafe(context.request)) {
        return json({ error: "Cross-site Shorts analytics writes are blocked." }, 403);
    }

    const snapshotKv = context.env.MOBILE_AUTH_KV || null;
    if (!snapshotKv) return json({ error: "MOBILE_AUTH_KV binding is required for Shorts performance snapshots." }, 503);

    const result = await buildShortsAnalytics(context, { includeSnapshots: false });
    if (result.response) return result.response;

    const snapshot = snapshotFromAnalytics(result.payload, context.env);
    const keyName = `${SNAPSHOT_PREFIX}${snapshot.id}`;
    await snapshotKv.put(keyName, JSON.stringify(snapshot), {
        metadata: {
            captured_at: snapshot.captured_at,
            views: snapshot.views,
            videos_published: snapshot.videos_published
        }
    });

    return json({ ok: true, key: keyName, snapshot }, 200);
}
