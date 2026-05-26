const SHORTS_PERIODS = {
    "1w": 7,
    "1m": 31,
    "3m": 92,
    "1y": 366,
    "5y": 366 * 5,
    all: Infinity
};

const SHORTS_HISTORY_METRICS = {
    views: "Views",
    likes: "Likes",
    comments: "Comments",
    videos_published: "Videos published",
    subscribers: "Subscribers"
};

const shortsChartState = {
    period: "1m",
    metric: "views"
};

function shortsEscapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function shortsFormatNumber(value, options = {}) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0";
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: options.maximumFractionDigits ?? 0 }).format(number);
}

function shortsFormatDecimal(value) {
    return shortsFormatNumber(value, { maximumFractionDigits: 1 });
}

function shortsFormatPercent(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0.00%";
    return new Intl.NumberFormat(undefined, {
        style: "percent",
        minimumFractionDigits: number > 0 && number < 0.001 ? 4 : 2,
        maximumFractionDigits: number > 0 && number < 0.001 ? 4 : 2
    }).format(Math.max(0, Math.min(1, number)));
}

function shortsFormatDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderShortsPerformanceSkeleton(target) {
    target.innerHTML = `
        <div class="shorts-performance-head">
            <h2>Shorts performance</h2>
            <span class="shorts-performance-status shorts-performance-skeleton">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
        </div>
        <div class="shorts-performance-grid">
            ${Array.from({ length: 4 }, () => `
                <div class="shorts-performance-metric">
                    <span class="shorts-performance-skeleton">&nbsp;</span>
                    <strong class="shorts-performance-skeleton">&nbsp;</strong>
                    <small class="shorts-performance-skeleton">&nbsp;</small>
                </div>
            `).join("")}
            <div class="shorts-monetization">
                <div class="shorts-progress-row">
                    <span>Monetisation</span>
                    <strong class="shorts-performance-skeleton">&nbsp;&nbsp;&nbsp;&nbsp;</strong>
                </div>
                <div class="shorts-progress-track"><div class="shorts-progress-bar"></div></div>
                <div class="shorts-progress-note shorts-performance-skeleton">&nbsp;</div>
            </div>
        </div>
    `;
}

function renderShortsSectionSkeleton(target, title) {
    if (!target) return;
    target.innerHTML = `
        <div class="shorts-section-head">
            <h2>${shortsEscapeHtml(title)}</h2>
            <span class="shorts-performance-status shorts-performance-skeleton">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
        </div>
        <div class="shorts-detail-skeleton">&nbsp;</div>
    `;
}

function renderShortsPerformance(target, payload, options = {}) {
    const totals = payload?.totals || {};
    const full = payload?.monetization?.full_ypp || {};
    const views = Number(totals.views || 0);
    const likes = Number(totals.likes || 0);
    const videos = Number(totals.videos_published || 0);
    const progress = Number(full.shorts_views_progress || 0);
    const targetViews = Number(full.shorts_views_required || 10000000);
    const metricSource = payload?.stats_source === "youtube_data_api" ? "live YouTube stats" : "saved performance rows";
    const updatedAt = payload?.updated_at ? new Date(payload.updated_at) : null;
    const status = updatedAt && !Number.isNaN(updatedAt.getTime())
        ? updatedAt.toLocaleDateString()
        : payload?.source_status === "missing"
            ? "No source"
            : "Current";

    target.innerHTML = `
        <div class="shorts-performance-head">
            <h2>Shorts performance</h2>
            ${options.link ? `<a href="/backend/shorts-analytics.html">Open analytics</a>` : `<span class="shorts-performance-status">${shortsEscapeHtml(status)}</span>`}
        </div>
        <div class="shorts-performance-grid">
            <div class="shorts-performance-metric">
                <span>Overall views</span>
                <strong>${shortsFormatNumber(views)}</strong>
                <small>from ${shortsEscapeHtml(metricSource)}</small>
            </div>
            <div class="shorts-performance-metric">
                <span>Likes</span>
                <strong>${shortsFormatNumber(likes)}</strong>
                <small>${shortsFormatNumber(totals.comments || 0)} comments</small>
            </div>
            <div class="shorts-performance-metric">
                <span>Videos published</span>
                <strong>${shortsFormatNumber(videos)}</strong>
                <small>${shortsFormatNumber(totals.shares || 0)} shares logged</small>
            </div>
            <div class="shorts-performance-metric">
                <span>Subscribers</span>
                <strong>${totals.subscribers == null ? "-" : shortsFormatNumber(totals.subscribers)}</strong>
                <small>Studio metric not connected</small>
            </div>
            <div class="shorts-monetization">
                <div class="shorts-progress-row">
                    <span>Monetisation progress</span>
                    <strong>${shortsFormatPercent(progress)}</strong>
                </div>
                <div class="shorts-progress-track" aria-hidden="true">
                    <div class="shorts-progress-bar" style="width: ${Math.max(0.2, Math.min(100, progress * 100))}%"></div>
                </div>
                <div class="shorts-progress-note">
                    ${shortsFormatNumber(views)} / ${shortsFormatNumber(targetViews)} valid public Shorts views in 90 days for full YPP ad-revenue eligibility; subscriber progress needs a Studio/API metric source.
                </div>
            </div>
        </div>
    `;
}

async function fetchShortsAnalytics() {
    const response = await fetch("/api/backend/shorts-analytics", {
        credentials: "same-origin",
        headers: { accept: "application/json" }
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || "Shorts analytics unavailable");
    return payload;
}

async function loadShortsPerformanceWidget(target, options = {}) {
    if (!target) return;
    renderShortsPerformanceSkeleton(target);
    try {
        const payload = await fetchShortsAnalytics();
        renderShortsPerformance(target, payload, options);
    } catch (error) {
        target.innerHTML = `
            <div class="shorts-performance-head">
                <h2>Shorts performance</h2>
                ${options.link ? `<a href="/backend/shorts-analytics.html">Open analytics</a>` : `<span class="shorts-performance-status">Unavailable</span>`}
            </div>
            <div class="shorts-progress-note">${shortsEscapeHtml(error.message || "Shorts analytics unavailable")}</div>
        `;
    }
}

function snapshotMetric(snapshot, metric) {
    const value = snapshot?.[metric];
    return value == null ? null : Number(value);
}

function filteredSnapshots(snapshots, period, metric) {
    const points = (snapshots || [])
        .map((snapshot) => ({
            date: new Date(snapshot.captured_at || snapshot.id || ""),
            value: snapshotMetric(snapshot, metric),
            raw: snapshot
        }))
        .filter((point) => !Number.isNaN(point.date.getTime()) && point.value != null && Number.isFinite(point.value));

    if (period === "all") return points;
    const days = SHORTS_PERIODS[period] || SHORTS_PERIODS["1m"];
    const newest = points.length ? Math.max(...points.map((point) => point.date.getTime())) : Date.now();
    const cutoff = newest - (days * 24 * 60 * 60 * 1000);
    return points.filter((point) => point.date.getTime() >= cutoff);
}

function renderHistorySvg(points) {
    const width = 720;
    const height = 260;
    const padding = { top: 24, right: 26, bottom: 42, left: 74 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max(1, ...points.map((point) => point.value));
    const minTime = points.length ? Math.min(...points.map((point) => point.date.getTime())) : Date.now();
    const maxTime = points.length ? Math.max(...points.map((point) => point.date.getTime())) : minTime + 1;
    const rangeTime = Math.max(1, maxTime - minTime);

    const coords = points.map((point) => {
        const x = padding.left + ((point.date.getTime() - minTime) / rangeTime) * plotWidth;
        const y = padding.top + plotHeight - ((point.value / maxValue) * plotHeight);
        return { x, y, point };
    });
    const path = coords.map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" ");
    const ticks = [0, 0.5, 1].map((ratio) => {
        const value = maxValue * ratio;
        const y = padding.top + plotHeight - (ratio * plotHeight);
        return `
            <g>
                <line x1="${padding.left}" x2="${width - padding.right}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" />
                <text x="${padding.left - 12}" y="${(y + 4).toFixed(1)}">${shortsEscapeHtml(shortsFormatNumber(value))}</text>
            </g>
        `;
    }).join("");
    const labels = coords.length ? [coords[0], coords[coords.length - 1]] : [];

    return `
        <svg class="shorts-history-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Shorts performance history line chart">
            <g class="shorts-chart-grid">${ticks}</g>
            ${path ? `<path class="shorts-chart-line" d="${path}" />` : ""}
            <g class="shorts-chart-points">
                ${coords.map((coord) => `<circle cx="${coord.x.toFixed(1)}" cy="${coord.y.toFixed(1)}" r="4"><title>${shortsEscapeHtml(shortsFormatDate(coord.point.date))}: ${shortsFormatNumber(coord.point.value)}</title></circle>`).join("")}
            </g>
            <g class="shorts-chart-axis">
                ${labels.map((coord, index) => `<text x="${coord.x.toFixed(1)}" y="${height - 14}" text-anchor="${index === 0 ? "start" : "end"}">${shortsEscapeHtml(shortsFormatDate(coord.point.date))}</text>`).join("")}
            </g>
        </svg>
    `;
}

function renderShortsHistory(target, payload) {
    if (!target) return;
    const snapshots = payload?.snapshots || [];
    const metric = shortsChartState.metric;
    const points = filteredSnapshots(snapshots, shortsChartState.period, metric);
    const hasSnapshots = snapshots.length > 0;

    target.innerHTML = `
        <div class="shorts-section-head">
            <h2>Performance history</h2>
            <span class="shorts-performance-status">${shortsFormatNumber(snapshots.length)} snapshots</span>
        </div>
        <div class="shorts-history-controls">
            <div class="shorts-segmented-control" role="group" aria-label="History period">
                ${Object.keys(SHORTS_PERIODS).map((period) => `
                    <button type="button" class="${period === shortsChartState.period ? "is-active" : ""}" data-shorts-period="${period}">${period}</button>
                `).join("")}
            </div>
            <label class="shorts-select-label">
                <span>Metric</span>
                <select data-shorts-history-metric>
                    ${Object.entries(SHORTS_HISTORY_METRICS).map(([key, label]) => `<option value="${key}" ${key === metric ? "selected" : ""}>${shortsEscapeHtml(label)}</option>`).join("")}
                </select>
            </label>
        </div>
        ${hasSnapshots ? renderHistorySvg(points) : `<div class="shorts-empty-note">No stored snapshots yet. The 8 AM review job will write the first daily point.</div>`}
    `;

    target.querySelectorAll("[data-shorts-period]").forEach((button) => {
        button.addEventListener("click", () => {
            shortsChartState.period = button.dataset.shortsPeriod || "1m";
            renderShortsHistory(target, payload);
        });
    });
    const metricSelect = target.querySelector("[data-shorts-history-metric]");
    if (metricSelect) {
        metricSelect.addEventListener("change", () => {
            shortsChartState.metric = metricSelect.value || "views";
            renderShortsHistory(target, payload);
        });
    }
}

function rowTitle(row) {
    return row.story_title || row.story_id || row.video_id || "Short";
}

function renderRankingList(rows, metric, label) {
    return `
        <section class="shorts-ranking-list">
            <div class="shorts-ranking-head">
                <h3>${shortsEscapeHtml(label)}</h3>
                <span>${shortsEscapeHtml(metric)}</span>
            </div>
            <ol>
                ${(rows || []).map((row) => `
                    <li>
                        <a href="${shortsEscapeHtml(row.video_url)}" target="_blank" rel="noreferrer">${shortsEscapeHtml(rowTitle(row))}</a>
                        <strong>${shortsFormatNumber(row[metric] || 0)}</strong>
                        <small>${shortsEscapeHtml(row.subreddit || "unknown")} · ${shortsEscapeHtml(row.tts_gender || "unknown")} · ${shortsEscapeHtml((row.subject_tags || []).slice(0, 4).join(", "))}</small>
                    </li>
                `).join("") || `<li class="shorts-empty-note">No videos yet.</li>`}
            </ol>
        </section>
    `;
}

function renderShortsRankings(target, payload) {
    if (!target) return;
    const rankings = payload?.rankings || {};
    target.innerHTML = `
        <div class="shorts-section-head">
            <h2>Individual video performance</h2>
            <span class="shorts-performance-status">Top 10</span>
        </div>
        <div class="shorts-ranking-grid">
            ${renderRankingList(rankings.views, "views", "Views")}
            ${renderRankingList(rankings.likes, "likes", "Likes")}
            ${renderRankingList(rankings.comments, "comments", "Comments")}
        </div>
    `;
}

function renderSegmentTable(title, rows) {
    return `
        <section class="shorts-segment-block">
            <h3>${shortsEscapeHtml(title)}</h3>
            <div class="shorts-segment-table-wrap">
                <table class="shorts-segment-table">
                    <thead>
                        <tr>
                            <th>Segment</th>
                            <th>Videos</th>
                            <th>Views</th>
                            <th>Avg views</th>
                            <th>Comments / 1k</th>
                            <th>Confidence</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(rows || []).map((row) => `
                            <tr>
                                <td>${shortsEscapeHtml(row.key)}</td>
                                <td>${shortsFormatNumber(row.videos)}</td>
                                <td>${shortsFormatNumber(row.views)}</td>
                                <td>${shortsFormatDecimal(row.avg_views)}</td>
                                <td>${shortsFormatDecimal(row.comments_per_1000_views)}</td>
                                <td>${shortsEscapeHtml(row.confidence || "low")}</td>
                            </tr>
                        `).join("") || `<tr><td colspan="6" class="shorts-empty-note">No eligible rows yet.</td></tr>`}
                    </tbody>
                </table>
            </div>
        </section>
    `;
}

function renderShortsSegments(target, payload) {
    if (!target) return;
    const segments = payload?.segments || {};
    target.innerHTML = `
        <div class="shorts-section-head">
            <h2>Segment analysis</h2>
            <span class="shorts-performance-status">${shortsFormatNumber(segments.source_video_count || 0)} eligible videos</span>
        </div>
        <p class="shorts-section-note">
            Learning rollups exclude rows marked flawed, superseded, rejected, removed, private, or "do not use for performance learning".
            ${segments.excluded_video_count ? `${shortsFormatNumber(segments.excluded_video_count)} active rows are excluded from selection guidance.` : ""}
        </p>
        <div class="shorts-segment-grid">
            ${renderSegmentTable("Subreddits", segments.subreddits)}
            ${renderSegmentTable("TTS gender", segments.voice_genders)}
            ${renderSegmentTable("Tags", segments.tags)}
            ${renderSegmentTable("Story themes", segments.themes)}
        </div>
    `;
}

function renderShortsDecision(target, payload) {
    if (!target) return;
    const guidance = payload?.decision_guidance || {};
    const minimum = guidance.minimum_before_strong_optimization || {};
    target.innerHTML = `
        <div class="shorts-section-head">
            <h2>Selection guidance</h2>
            <span class="shorts-performance-status">${shortsEscapeHtml(guidance.strategy || "explore_broadly")}</span>
        </div>
        <div class="shorts-guidance-grid">
            <div>
                <span>Learning sample</span>
                <strong>${shortsFormatNumber(guidance.learning_video_count || 0)} videos</strong>
                <small>${shortsFormatNumber(guidance.learning_view_count || 0)} eligible views</small>
            </div>
            <div>
                <span>Optimization floor</span>
                <strong>${shortsFormatNumber(minimum.videos || 15)} videos</strong>
                <small>${shortsFormatNumber(minimum.views || 5000)} views and ${shortsFormatNumber(minimum.videos_per_segment || 3)} videos per segment</small>
            </div>
        </div>
        <p class="shorts-section-note">${shortsEscapeHtml(guidance.guidance || "")}</p>
        <p class="shorts-section-note">${shortsEscapeHtml(guidance.voice_rule || "")}</p>
    `;
}

async function loadShortsAnalyticsPage(targets) {
    if (!targets?.performance) return;
    renderShortsPerformanceSkeleton(targets.performance);
    renderShortsSectionSkeleton(targets.history, "Performance history");
    renderShortsSectionSkeleton(targets.rankings, "Individual video performance");
    renderShortsSectionSkeleton(targets.segments, "Segment analysis");
    renderShortsSectionSkeleton(targets.decision, "Selection guidance");

    try {
        const payload = await fetchShortsAnalytics();
        renderShortsPerformance(targets.performance, payload);
        renderShortsHistory(targets.history, payload);
        renderShortsRankings(targets.rankings, payload);
        renderShortsSegments(targets.segments, payload);
        renderShortsDecision(targets.decision, payload);
    } catch (error) {
        const message = shortsEscapeHtml(error.message || "Shorts analytics unavailable");
        targets.performance.innerHTML = `
            <div class="shorts-performance-head">
                <h2>Shorts performance</h2>
                <span class="shorts-performance-status">Unavailable</span>
            </div>
            <div class="shorts-progress-note">${message}</div>
        `;
    }
}

window.loadShortsPerformanceWidget = loadShortsPerformanceWidget;
window.loadShortsAnalyticsPage = loadShortsAnalyticsPage;
