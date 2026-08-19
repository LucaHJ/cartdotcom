const SOURCE_EXPANSION_CUTOFF = "2026-07-18T08:28:55Z";
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function brisbaneDateParts(timestamp = Date.now()) {
  const shifted = new Date(timestamp + BRISBANE_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function brisbaneLocalToUtc(year, month, day, hour = 0) {
  return Date.UTC(year, month - 1, day, hour) - BRISBANE_OFFSET_MS;
}

function activityAnchor(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return brisbaneDateParts();
  const [year, month, day] = match.slice(1).map(Number);
  const valid = new Date(Date.UTC(year, month - 1, day));
  return valid.getUTCFullYear() === year && valid.getUTCMonth() === month - 1 && valid.getUTCDate() === day
    ? { year, month, day }
    : brisbaneDateParts();
}

function localDateLabel(timestamp, options) {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", ...options }).format(new Date(timestamp));
}

function impactDetailForSymbol(memo, symbol) {
  const parsed = parseJson(memo, {});
  const details = Array.isArray(parsed.impact_details) ? parsed.impact_details : [];
  return details.find((detail) => String(detail?.symbol || "").toUpperCase() === symbol.toUpperCase()) || null;
}

export function createAnalyticsApi(pool) {
  async function eventSummaries(limit) {
    const result = await pool.query(`
      SELECT rr.*, a.title, a.url, a.published_at, s.name AS source_name,
        coalesce(json_agg(json_build_object(
          'symbol', po.symbol,
          'company', po.company,
          'direction', po.direction,
          'rationale', po.rationale,
          'confidence', po.confidence,
          'baseline_price', po.baseline_price,
          'baseline_at', po.baseline_at,
          'intervals', po.intervals_json::jsonb,
          'updated_at', po.updated_at
        ) ORDER BY po.symbol) FILTER (WHERE po.symbol IS NOT NULL), '[]'::json) AS cached_impacts
      FROM research_results rr
      INNER JOIN articles a ON a.id = rr.article_id
      LEFT JOIN sources s ON s.id = a.source_id
      LEFT JOIN prediction_outcomes po ON po.result_id = rr.id
      WHERE a.status != 'archived'
        AND rr.symbols IS NOT NULL
        AND btrim(rr.symbols) NOT IN ('', '[]')
      GROUP BY rr.id, rr.job_id, rr.article_id, rr.companies, rr.symbols,
        rr.industries, rr.event_type, rr.sentiment_score, rr.impact_horizon,
        rr.confidence, rr.summary, rr.memo, rr.created_at,
        a.title, a.url, a.published_at, s.name
      ORDER BY rr.created_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows.map((row) => {
      const priceImpacts = (row.cached_impacts || []).map((impact) => {
        const detail = impactDetailForSymbol(row.memo, impact.symbol);
        return {
          article_id: row.article_id,
          title: row.title,
          url: row.url,
          published_at: row.published_at,
          sentiment_score: row.sentiment_score,
          confidence: impact.confidence ?? row.confidence,
          symbol: impact.symbol,
          company: impact.company || detail?.name || null,
          direction: impact.direction || detail?.direction || null,
          rationale: impact.rationale || detail?.reason || null,
          baseline_price: impact.baseline_price,
          baseline_at: impact.baseline_at,
          intervals: impact.intervals || {},
        };
      });
      delete row.cached_impacts;
      return { ...row, price_impacts: priceImpacts };
    });
  }

  async function modelExperiment(experimentId = null) {
    const experimentResult = experimentId
      ? await pool.query("SELECT * FROM model_experiments WHERE id = $1", [experimentId])
      : await pool.query("SELECT * FROM model_experiments ORDER BY created_at DESC LIMIT 1");
    const experiment = experimentResult.rows[0] || null;
    if (!experiment) return { experiment: null, progress: [] };
    const progress = await pool.query(`
      SELECT phase, model, reasoning_effort, status, count(*)::integer AS count,
        avg(duration_seconds) AS average_duration_seconds
      FROM model_experiment_jobs
      WHERE experiment_id = $1
      GROUP BY phase, model, reasoning_effort, status
      ORDER BY phase, status
    `, [experiment.id]);
    return {
      experiment: {
        ...experiment,
        report: parseJson(experiment.report_json, null),
        report_json: undefined,
        report_text: experiment.report_text || null,
      },
      progress: progress.rows,
    };
  }

  async function sourceStats() {
    const result = await pool.query(`
      WITH ledger_stats AS (
        SELECT source_id, count(*)::integer AS ledger_seen_count,
          count(*) FILTER (WHERE disposition IN ('acquired', 'duplicate'))::integer AS ledger_acquired_count,
          count(*) FILTER (WHERE disposition = 'baseline')::integer AS ledger_baseline_count,
          count(*) FILTER (WHERE disposition = 'stale')::integer AS ledger_stale_count,
          count(*) FILTER (WHERE disposition = 'pending')::integer AS ledger_pending_count,
          count(*) FILTER (WHERE disposition = 'duplicate')::integer AS ledger_duplicate_count
        FROM feed_item_ledger GROUP BY source_id
      ), article_counts AS (
        SELECT source_id, count(*)::integer AS acquired_article_count FROM articles GROUP BY source_id
      ), valid_source_outcomes AS MATERIALIZED (
        SELECT a.source_id, po.direction, po.intervals_json::jsonb AS intervals
        FROM prediction_outcomes po
        INNER JOIN research_results rr ON rr.id = po.result_id
        INNER JOIN articles a ON a.id = rr.article_id
        WHERE po.direction IN ('bullish', 'bearish')
          AND po.prediction_at = coalesce(a.published_at, rr.created_at)
      ), eligible_movements AS (
        SELECT source_id, direction, (interval.value ->> 'change_pct')::double precision AS movement_pct
        FROM valid_source_outcomes
        CROSS JOIN LATERAL jsonb_each(intervals) AS interval
        WHERE jsonb_typeof(interval.value -> 'change_pct') = 'number'
      ), movement_stats AS (
        SELECT source_id,
          avg(movement_pct) FILTER (WHERE direction = 'bullish') AS bullish_average_movement_pct,
          count(*) FILTER (WHERE direction = 'bullish')::integer AS bullish_samples,
          avg(movement_pct) FILTER (WHERE direction = 'bearish') AS bearish_average_movement_pct,
          count(*) FILTER (WHERE direction = 'bearish')::integer AS bearish_samples
        FROM eligible_movements GROUP BY source_id
      )
      SELECT s.id, s.name, s.url, s.category, s.source_type,
        coalesce(ac.acquired_article_count, 0) AS acquired_article_count,
        coalesce(ls.ledger_seen_count, 0) AS ledger_seen_count,
        coalesce(ls.ledger_acquired_count, 0) AS ledger_acquired_count,
        coalesce(ls.ledger_baseline_count, 0) AS ledger_baseline_count,
        coalesce(ls.ledger_stale_count, 0) AS ledger_stale_count,
        coalesce(ls.ledger_pending_count, 0) AS ledger_pending_count,
        coalesce(ls.ledger_duplicate_count, 0) AS ledger_duplicate_count,
        ms.bullish_average_movement_pct, coalesce(ms.bullish_samples, 0) AS bullish_samples,
        ms.bearish_average_movement_pct, coalesce(ms.bearish_samples, 0) AS bearish_samples
      FROM sources s
      LEFT JOIN ledger_stats ls ON ls.source_id = s.id
      LEFT JOIN article_counts ac ON ac.source_id = s.id
      LEFT JOIN movement_stats ms ON ms.source_id = s.id
      WHERE s.enabled != 0
      ORDER BY acquired_article_count DESC, s.weight DESC, s.name ASC
    `);
    return result.rows;
  }

  async function sourceActivity(modeValue, anchorValue) {
    const mode = modeValue === "month" || modeValue === "year" ? modeValue : "day";
    const anchor = activityAnchor(anchorValue);
    const normalizedAnchor = `${anchor.year}-${String(anchor.month).padStart(2, "0")}-${String(anchor.day).padStart(2, "0")}`;
    const currentHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    let rangeStart = brisbaneLocalToUtc(anchor.year, anchor.month, anchor.day);
    let rangeEnd = rangeStart + 24 * HOUR_MS;
    let periodLabel = localDateLabel(rangeStart, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
    let axisLabel = "Hour of day (Brisbane time)";
    if (mode === "month") {
      rangeStart = brisbaneLocalToUtc(anchor.year, anchor.month, 1);
      rangeEnd = brisbaneLocalToUtc(anchor.year, anchor.month + 1, 1);
      periodLabel = localDateLabel(rangeStart, { month: "long", year: "numeric" });
      axisLabel = "Day of month (Brisbane time)";
    } else if (mode === "year") {
      rangeStart = brisbaneLocalToUtc(anchor.year, 1, 1);
      rangeEnd = brisbaneLocalToUtc(anchor.year + 1, 1, 1);
      periodLabel = String(anchor.year);
      axisLabel = "Week of year (Brisbane time)";
    }

    const metrics = await pool.query(`
      SELECT hour_start, article_count, ticker_count
      FROM source_hourly_metrics
      WHERE hour_start >= $1 AND hour_start < $2 AND hour_start < $3
      ORDER BY hour_start
    `, [new Date(rangeStart), new Date(rangeEnd), new Date(currentHour + HOUR_MS)]);
    const hourly = new Map(metrics.rows.map((row) => [Math.floor(new Date(row.hour_start).getTime() / HOUR_MS) * HOUR_MS, {
      articles: Number(row.article_count || 0), tickers: Number(row.ticker_count || 0),
    }]));
    const sumRange = (start, end) => {
      let articles = 0;
      let tickers = 0;
      for (let hour = start; hour < Math.min(end, currentHour + HOUR_MS); hour += HOUR_MS) {
        const row = hourly.get(hour);
        articles += row?.articles || 0;
        tickers += row?.tickers || 0;
      }
      return { articles, tickers };
    };

    const buckets = [];
    const ticks = [];
    const separators = [];
    let domainMax = 24;
    if (mode === "day") {
      for (let hour = 0; hour < 24; hour += 1) {
        const start = rangeStart + hour * HOUR_MS;
        const totals = sumRange(start, start + HOUR_MS);
        const label = (value) => value === 0 || value === 24 ? "12am" : value === 12 ? "12pm" : value < 12 ? `${value}am` : `${value - 12}pm`;
        buckets.push({ position: hour + 0.5, label: `${label(hour)}-${label(hour + 1)}`, articles: start <= currentHour ? totals.articles : null, tickers: start <= currentHour ? totals.tickers : null, partial: start === currentHour });
      }
      for (let hour = 0; hour <= 24; hour += 4) ticks.push({ position: hour, label: hour === 24 ? "12am" : hour === 12 ? "12pm" : hour === 0 ? "12am" : hour < 12 ? `${hour}am` : `${hour - 12}pm` });
    } else if (mode === "month") {
      const days = Math.round((rangeEnd - rangeStart) / (24 * HOUR_MS));
      domainMax = days;
      let weekNumber = 0;
      for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
        const start = rangeStart + dayIndex * 24 * HOUR_MS;
        const end = start + 24 * HOUR_MS;
        const totals = sumRange(start, end);
        buckets.push({ position: dayIndex + 0.5, label: localDateLabel(start, { weekday: "short", day: "numeric", month: "short" }), articles: start <= currentHour ? totals.articles : null, tickers: start <= currentHour ? totals.tickers : null, partial: start <= currentHour && end > currentHour });
        if (dayIndex === 0 || new Date(start + BRISBANE_OFFSET_MS).getUTCDay() === 1) separators.push({ position: dayIndex, label: `Week ${++weekNumber}` });
      }
      const tickStep = days > 28 ? 5 : 4;
      for (let day = 1; day <= days; day += tickStep) ticks.push({ position: day - 0.5, label: String(day) });
      if (!ticks.some((tick) => tick.position === days - 0.5)) ticks.push({ position: days - 0.5, label: String(days) });
    } else {
      const yearDays = Math.round((rangeEnd - rangeStart) / (24 * HOUR_MS));
      domainMax = yearDays / 7;
      let weekNumber = 1;
      for (let weekStart = rangeStart; weekStart < rangeEnd; weekStart += 7 * 24 * HOUR_MS) {
        const weekEnd = Math.min(weekStart + 7 * 24 * HOUR_MS, rangeEnd);
        const totals = sumRange(weekStart, weekEnd);
        buckets.push({ position: ((weekStart + weekEnd) / 2 - rangeStart) / (7 * 24 * HOUR_MS), label: `Week ${weekNumber}: ${localDateLabel(weekStart, { day: "numeric", month: "short" })}-${localDateLabel(weekEnd - 1, { day: "numeric", month: "short" })}`, articles: weekStart <= currentHour ? totals.articles : null, tickers: weekStart <= currentHour ? totals.tickers : null, partial: weekStart <= currentHour && weekEnd > currentHour });
        if (weekNumber === 1 || weekNumber % 4 === 1) ticks.push({ position: (weekStart - rangeStart) / (7 * 24 * HOUR_MS), label: `W${weekNumber}` });
        weekNumber += 1;
      }
      for (let month = 1; month <= 12; month += 1) separators.push({ position: (brisbaneLocalToUtc(anchor.year, month, 1) - rangeStart) / (7 * 24 * HOUR_MS), label: localDateLabel(brisbaneLocalToUtc(anchor.year, month, 1), { month: "short" }) });
    }

    const earliest = await pool.query("SELECT min(checked_at) AS checked_at FROM source_checks WHERE checked_at >= $1", [SOURCE_EXPANSION_CUTOFF]);
    const firstCheck = earliest.rows[0]?.checked_at ? new Date(earliest.rows[0].checked_at).getTime() : currentHour;
    const averageStart = Math.ceil(firstCheck / HOUR_MS) * HOUR_MS;
    const completedHours = Math.max(0, Math.floor((currentHour - averageStart) / HOUR_MS));
    const totals = completedHours ? await pool.query(`
      SELECT coalesce(sum(article_count), 0) AS articles, coalesce(sum(ticker_count), 0) AS tickers
      FROM source_hourly_metrics WHERE hour_start >= $1 AND hour_start < $2
    `, [new Date(averageStart), new Date(currentHour)]) : { rows: [{}] };
    const averageTotals = totals.rows[0] || {};
    const current = brisbaneDateParts();
    const currentPeriodStart = mode === "day" ? brisbaneLocalToUtc(current.year, current.month, current.day) : mode === "month" ? brisbaneLocalToUtc(current.year, current.month, 1) : brisbaneLocalToUtc(current.year, 1, 1);
    return {
      ok: true, timezone: "Australia/Brisbane", mode, anchor: normalizedAnchor,
      period_label: periodLabel, axis_label: axisLabel,
      bucket_note: mode === "day" ? "hourly totals" : mode === "month" ? "daily totals with week boundaries" : "weekly totals with month boundaries",
      can_go_next: rangeStart < currentPeriodStart, domain_max: domainMax, buckets, ticks, separators,
      average: {
        completed_hours: completedHours,
        articles_per_hour: completedHours ? Number(averageTotals.articles || 0) / completedHours : 0,
        tickers_per_hour: completedHours ? Number(averageTotals.tickers || 0) / completedHours : 0,
        total_articles: Number(averageTotals.articles || 0), total_tickers: Number(averageTotals.tickers || 0),
        starts_at: completedHours ? new Date(averageStart).toISOString() : null,
        ends_at: new Date(currentHour).toISOString(),
      },
    };
  }

  async function tickerPipelineDiagnostics(requestedSince) {
    const parsedSince = requestedSince ? Date.parse(requestedSince) : Number.NaN;
    const since = new Date(Number.isFinite(parsedSince) ? parsedSince : Date.now() - 14 * 24 * HOUR_MS);
    const brisbaneDay = (column) => `to_char(timezone('Australia/Brisbane', ${column}), 'YYYY-MM-DD')`;
    const queries = await Promise.all([
      pool.query(`SELECT ${brisbaneDay("discovered_at")} AS day, count(*)::integer AS articles,
        count(*) FILTER (WHERE status = 'queued')::integer AS queued,
        count(*) FILTER (WHERE status = 'analyzed')::integer AS analyzed,
        count(*) FILTER (WHERE status = 'archived')::integer AS archived
        FROM articles WHERE discovered_at >= $1 GROUP BY day ORDER BY day`, [since]),
      pool.query(`SELECT ${brisbaneDay("a.discovered_at")} AS day,
        count(DISTINCT rr.id)::integer AS results,
        count(DISTINCT rr.id) FILTER (WHERE rr.symbols IS NOT NULL AND btrim(rr.symbols) NOT IN ('', '[]'))::integer AS results_with_symbols,
        count(po.id)::integer AS ticker_calls,
        count(DISTINCT rr.id) FILTER (WHERE rr.symbols IS NULL OR btrim(rr.symbols) IN ('', '[]'))::integer AS tickerless_results
        FROM research_results rr INNER JOIN articles a ON a.id = rr.article_id
        LEFT JOIN prediction_outcomes po ON po.result_id = rr.id
        WHERE a.discovered_at >= $1 GROUP BY day ORDER BY day`, [since]),
      pool.query(`SELECT ${brisbaneDay("rr.created_at")} AS day,
        count(DISTINCT rr.id)::integer AS results,
        count(DISTINCT rr.id) FILTER (WHERE rr.symbols IS NOT NULL AND btrim(rr.symbols) NOT IN ('', '[]'))::integer AS results_with_symbols,
        count(po.id)::integer AS ticker_calls,
        count(DISTINCT rr.id) FILTER (WHERE rr.symbols IS NULL OR btrim(rr.symbols) IN ('', '[]'))::integer AS tickerless_results
        FROM research_results rr LEFT JOIN prediction_outcomes po ON po.result_id = rr.id
        WHERE rr.created_at >= $1 GROUP BY day ORDER BY day`, [since]),
      pool.query(`SELECT ${brisbaneDay("coalesce(finished_at, queued_at)")} AS day, status, count(*)::integer AS jobs
        FROM research_jobs WHERE coalesce(finished_at, queued_at) >= $1 GROUP BY day, status ORDER BY day, status`, [since]),
      pool.query(`SELECT ${brisbaneDay("updated_at")} AS day, count(*)::integer AS outcomes,
        count(DISTINCT article_id)::integer AS articles, min(prediction_at) AS earliest_prediction_at,
        max(prediction_at) AS latest_prediction_at FROM prediction_outcomes
        WHERE updated_at >= $1 GROUP BY day ORDER BY day`, [since]),
      pool.query(`SELECT ${brisbaneDay("scanned_at")} AS day, count(*)::integer AS scanned_results,
        coalesce(sum(outcome_count), 0)::integer AS outcomes_recorded,
        coalesce(sum(skipped_count), 0)::integer AS symbols_skipped
        FROM prediction_outcome_scans WHERE scanned_at >= $1 GROUP BY day ORDER BY day`, [since]),
      pool.query(`SELECT ${brisbaneDay("hour_start")} AS day,
        coalesce(sum(article_count), 0)::integer AS articles,
        coalesce(sum(ticker_count), 0)::integer AS ticker_calls
        FROM source_hourly_metrics WHERE hour_start >= $1 GROUP BY day ORDER BY day`, [since]),
      pool.query(`SELECT max(rr.created_at) AS latest_result_at,
        max(rr.created_at) FILTER (WHERE rr.symbols IS NOT NULL AND btrim(rr.symbols) NOT IN ('', '[]')) AS latest_symbol_result_at,
        max(a.discovered_at) FILTER (WHERE rr.symbols IS NOT NULL AND btrim(rr.symbols) NOT IN ('', '[]')) AS latest_symbol_article_discovered_at,
        max(a.published_at) FILTER (WHERE rr.symbols IS NOT NULL AND btrim(rr.symbols) NOT IN ('', '[]')) AS latest_symbol_article_published_at
        FROM research_results rr LEFT JOIN articles a ON a.id = rr.article_id`),
      pool.query(`SELECT max(updated_at) AS latest_outcome_update_at,
        max(prediction_at) AS latest_outcome_prediction_at, count(*)::integer AS total_outcomes
        FROM prediction_outcomes`),
      pool.query(`SELECT left(coalesce(last_error, 'unknown'), 180) AS reason, count(*)::integer AS failures
        FROM research_jobs WHERE status = 'failed' AND finished_at >= $1
        GROUP BY reason ORDER BY failures DESC LIMIT 10`, [since]),
      pool.query(`SELECT count(*)::integer AS samples,
        avg(rj.prediction_delay_seconds) AS average_total_seconds,
        count(*) FILTER (WHERE rj.prediction_delay_seconds >= 3600)::integer AS over_one_hour,
        count(*) FILTER (WHERE rj.prediction_delay_seconds >= 21600)::integer AS over_six_hours,
        count(*) FILTER (WHERE rj.prediction_delay_seconds >= 86400)::integer AS over_one_day,
        (SELECT count(*)::integer FROM research_jobs WHERE prediction_delay_eligible = 2) AS excluded_recovery_jobs
        FROM research_jobs rj INNER JOIN articles a ON a.id = rj.article_id
        WHERE rj.status = 'succeeded' AND rj.prediction_delay_eligible = 1
          AND rj.prediction_delay_seconds IS NOT NULL`),
      pool.query(`SELECT coalesce(s.name, a.source_id, 'unknown') AS source,
        count(*)::integer AS samples, avg(rj.prediction_delay_seconds) AS average_total_seconds,
        sum(rj.prediction_delay_seconds) AS cumulative_delay_seconds
        FROM research_jobs rj INNER JOIN articles a ON a.id = rj.article_id
        LEFT JOIN sources s ON s.id = a.source_id
        WHERE rj.status = 'succeeded' AND rj.prediction_delay_eligible = 1
          AND rj.prediction_delay_seconds IS NOT NULL
        GROUP BY a.source_id, s.name ORDER BY cumulative_delay_seconds DESC LIMIT 12`),
    ]);
    return {
      ok: true,
      since: since.toISOString(),
      timezone: "Australia/Brisbane",
      article_cohorts: queries[0].rows,
      results_by_article_cohort: queries[1].rows,
      results_by_completion_day: queries[2].rows,
      jobs_by_completion_day: queries[3].rows,
      outcomes_by_update_day: queries[4].rows,
      outcome_scans_by_day: queries[5].rows,
      source_metrics_by_day: queries[6].rows,
      latest: { ...(queries[7].rows[0] || {}), ...(queries[8].rows[0] || {}) },
      recent_failure_reasons: queries[9].rows,
      prediction_delay: queries[10].rows[0] || {},
      prediction_delay_by_source: queries[11].rows,
    };
  }

  return { eventSummaries, modelExperiment, sourceActivity, sourceStats, tickerPipelineDiagnostics };
}
