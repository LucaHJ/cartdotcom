function shortsFormatNumber(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0";
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(number);
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

function renderShortsPerformance(target, payload, options = {}) {
    const totals = payload?.totals || {};
    const full = payload?.monetization?.full_ypp || {};
    const views = Number(totals.views || 0);
    const likes = Number(totals.likes || 0);
    const videos = Number(totals.videos_published || 0);
    const progress = Number(full.shorts_views_progress || 0);
    const targetViews = Number(full.shorts_views_required || 10000000);
    const updatedAt = payload?.updated_at ? new Date(payload.updated_at) : null;
    const status = updatedAt && !Number.isNaN(updatedAt.getTime())
        ? updatedAt.toLocaleDateString()
        : payload?.source_status === "missing"
            ? "No source"
            : "Current";

    target.innerHTML = `
        <div class="shorts-performance-head">
            <h2>Shorts performance</h2>
            ${options.link ? `<a href="/backend/shorts-analytics.html">Open analytics</a>` : `<span class="shorts-performance-status">${status}</span>`}
        </div>
        <div class="shorts-performance-grid">
            <div class="shorts-performance-metric">
                <span>Overall views</span>
                <strong>${shortsFormatNumber(views)}</strong>
                <small>from saved performance rows</small>
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
                <strong>${totals.subscribers == null ? "—" : shortsFormatNumber(totals.subscribers)}</strong>
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

async function loadShortsPerformanceWidget(target, options = {}) {
    if (!target) return;
    renderShortsPerformanceSkeleton(target);
    try {
        const response = await fetch("/api/backend/shorts-analytics", {
            credentials: "same-origin",
            headers: { accept: "application/json" }
        });
        const payload = await response.json();
        if (!response.ok || payload.error) throw new Error(payload.error || "Shorts analytics unavailable");
        renderShortsPerformance(target, payload, options);
    } catch (error) {
        target.innerHTML = `
            <div class="shorts-performance-head">
                <h2>Shorts performance</h2>
                ${options.link ? `<a href="/backend/shorts-analytics.html">Open analytics</a>` : `<span class="shorts-performance-status">Unavailable</span>`}
            </div>
            <div class="shorts-progress-note">${error.message || "Shorts analytics unavailable"}</div>
        `;
    }
}
