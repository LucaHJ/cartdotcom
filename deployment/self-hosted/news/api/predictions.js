const INTERVALS = ["12h", "24h", "48h", "1w", "2w", "1m", "3m", "6m", "1y", "2y", "3y", "4y"];
const SORTS = new Set(["newest", "oldest", "current_desc", "current_asc", "peak_desc", "peak_asc"]);
const DATE_MATCH = "po.prediction_at = COALESCE(a.published_at, rr.created_at)";
const CONFIDENCE_PCT = "CASE WHEN po.confidence <= 1 THEN po.confidence * 100 ELSE po.confidence END";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function filtersFromUrl(url) {
  const directionValue = url.searchParams.get("direction");
  const direction = directionValue === "bullish" || directionValue === "bearish" ? directionValue : null;
  const sortValue = url.searchParams.get("sort") || "newest";
  const sort = SORTS.has(sortValue) ? sortValue : "newest";
  const parseConfidence = (name) => {
    const raw = url.searchParams.get(name);
    if (raw === null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  };
  const confidenceMin = parseConfidence("confidence_min");
  const requestedMax = parseConfidence("confidence_max");
  return {
    direction,
    confidenceMin,
    confidenceMax: confidenceMin !== null && requestedMax !== null && requestedMax <= confidenceMin ? null : requestedMax,
    sort,
    cursor: url.searchParams.get("cursor"),
  };
}

function encodeCursor(offset, sort) {
  return Buffer.from(JSON.stringify({ offset, sort }), "utf8").toString("base64url");
}

function decodeCursor(cursor, sort) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return parsed.sort === sort && Number.isInteger(parsed.offset) && parsed.offset >= 0 ? parsed.offset : 0;
  } catch {
    return 0;
  }
}

function whereForFilters(filters) {
  const clauses = [DATE_MATCH, "po.direction IN ('bullish', 'bearish')"];
  const values = [];
  if (filters.direction) {
    values.push(filters.direction);
    clauses.push(`po.direction = $${values.length}`);
  }
  if (filters.confidenceMin !== null) {
    values.push(filters.confidenceMin);
    clauses.push(`${CONFIDENCE_PCT} >= $${values.length}`);
  }
  if (filters.confidenceMax !== null) {
    values.push(filters.confidenceMax);
    clauses.push(`${CONFIDENCE_PCT} ${filters.confidenceMax >= 100 ? "<=" : "<"} $${values.length}`);
  }
  return { sql: clauses.join(" AND "), values };
}

function orderForSort(sort) {
  const groupTail = "gm.latest_prediction_at DESC, enriched.article_id DESC";
  if (sort === "oldest") return "gm.latest_prediction_at ASC, enriched.article_id ASC, enriched.id ASC";
  if (sort === "current_desc") return `gm.current_max DESC NULLS LAST, ${groupTail}, enriched.current_movement_pct DESC NULLS LAST, enriched.id DESC`;
  if (sort === "current_asc") return `gm.current_min ASC NULLS LAST, ${groupTail}, enriched.current_movement_pct ASC NULLS LAST, enriched.id DESC`;
  if (sort === "peak_desc") return `gm.peak_max DESC NULLS LAST, ${groupTail}, enriched.peak_movement_pct DESC NULLS LAST, enriched.id DESC`;
  if (sort === "peak_asc") return `gm.peak_min ASC NULLS LAST, ${groupTail}, enriched.peak_movement_pct ASC NULLS LAST, enriched.id DESC`;
  return `${groupTail}, enriched.id DESC`;
}

function normalizeIntervals(raw, confidence) {
  let intervals = {};
  try {
    intervals = typeof raw === "string" ? JSON.parse(raw) : raw || {};
  } catch {
    intervals = {};
  }
  const confidencePct = confidence === null ? null : confidence <= 1 ? confidence * 100 : confidence;
  const eligibleConfidence = confidencePct !== null && confidencePct >= 0 && confidencePct <= 100;
  for (const point of Object.values(intervals)) {
    if (!point || typeof point !== "object") continue;
    point.counts_toward_accuracy = eligibleConfidence && numberOrNull(point.change_pct) !== null;
  }
  return intervals;
}

function outcomeFromRow(row) {
  const predictionAt = row.prediction_at instanceof Date ? row.prediction_at.toISOString() : row.prediction_at;
  const ageMilliseconds = Date.now() - new Date(predictionAt).getTime();
  const confidence = numberOrNull(row.confidence);
  return {
    id: row.id,
    result_id: row.result_id,
    article_id: row.article_id,
    title: row.article_title,
    url: row.article_url,
    symbol: row.symbol,
    company: row.company,
    direction: row.direction,
    score: numberOrNull(row.score),
    confidence,
    rationale: row.rationale,
    prediction_at: predictionAt,
    baseline_price: numberOrNull(row.baseline_price),
    baseline_at: row.baseline_at,
    intervals: normalizeIntervals(row.intervals_json, confidence),
    daily_points: row.daily_points || [],
    days_since_call: Number.isFinite(ageMilliseconds) ? Math.max(0, Math.floor(ageMilliseconds / 86_400_000)) : 0,
    current_price: numberOrNull(row.current_price),
    current_price_at: row.current_price_at,
    current_movement_pct: numberOrNull(row.current_movement_pct),
    peak_movement_pct: numberOrNull(row.peak_movement_pct),
    updated_at: row.updated_at,
  };
}

export function createPredictionApi(pool) {
  let summaryCache = null;
  let dailyCache = null;

  async function coverage() {
    const result = await pool.query(`
      SELECT
        count(*) FILTER (WHERE ${DATE_MATCH})::integer AS predictions,
        count(DISTINCT po.article_id) FILTER (WHERE ${DATE_MATCH})::integer AS articles,
        count(DISTINCT po.result_id) FILTER (WHERE NOT (${DATE_MATCH}))::integer AS date_repair_pending
      FROM prediction_outcomes po
      INNER JOIN research_results rr ON rr.id = po.result_id
      LEFT JOIN articles a ON a.id = rr.article_id
    `);
    const row = result.rows[0];
    return {
      predictions: Number(row.predictions || 0),
      articles: Number(row.articles || 0),
      date_repair_pending: Number(row.date_repair_pending || 0),
    };
  }

  async function summary() {
    if (summaryCache && summaryCache.expiresAt > Date.now()) return summaryCache.value;
    const result = await pool.query(`
      WITH accuracy_predictions AS MATERIALIZED (
        SELECT po.direction, ${CONFIDENCE_PCT} AS confidence_pct, po.intervals_json::jsonb AS intervals
        FROM prediction_outcomes po
        INNER JOIN research_results rr ON rr.id = po.result_id
        LEFT JOIN articles a ON a.id = rr.article_id
        WHERE po.direction IN ('bullish', 'bearish')
          AND po.confidence IS NOT NULL
          AND ${DATE_MATCH}
      ), eligible AS MATERIALIZED (
        SELECT direction,
          LEAST(9, floor(confidence_pct / 10))::integer AS confidence_bin,
          interval.key AS interval,
          (interval.value ->> 'change_pct')::double precision AS movement_pct
        FROM accuracy_predictions
        CROSS JOIN LATERAL jsonb_each(accuracy_predictions.intervals) AS interval
        WHERE confidence_pct BETWEEN 0 AND 100
          AND interval.key = ANY($1::text[])
          AND jsonb_typeof(interval.value -> 'change_pct') = 'number'
      )
      SELECT interval, direction, confidence_bin, count(*)::integer AS samples,
        count(*) FILTER (WHERE (direction = 'bullish' AND movement_pct > 0)
          OR (direction = 'bearish' AND movement_pct < 0))::integer AS accurate,
        avg(movement_pct) AS average_movement_pct
      FROM eligible
      GROUP BY interval, direction, confidence_bin
    `, [INTERVALS]);

    const byCell = new Map(result.rows.map((row) => [`${row.interval}:${row.direction}:${row.confidence_bin}`, row]));
    const cellsFor = (interval, direction) => Array.from({ length: 10 }, (_, confidenceBin) => {
      const row = byCell.get(`${interval}:${direction}:${confidenceBin}`);
      const samples = Number(row?.samples || 0);
      return {
        confidence_min: confidenceBin * 10,
        confidence_max: (confidenceBin + 1) * 10,
        samples,
        accuracy_pct: samples ? (Number(row.accurate || 0) / samples) * 100 : null,
        average_movement_pct: numberOrNull(row?.average_movement_pct),
      };
    });
    const value = INTERVALS.map((interval) => ({
      interval,
      bullish: cellsFor(interval, "bullish"),
      bearish: cellsFor(interval, "bearish"),
    }));
    summaryCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  }

  async function daily() {
    if (dailyCache && dailyCache.expiresAt > Date.now()) return dailyCache.value;
    const result = await pool.query(`
      WITH chart_predictions AS MATERIALIZED (
        SELECT po.id, po.direction, po.prediction_at,
          LEAST(9, floor((${CONFIDENCE_PCT}) / 10))::integer AS confidence_bin
        FROM prediction_outcomes po
        INNER JOIN research_results rr ON rr.id = po.result_id
        LEFT JOIN articles a ON a.id = rr.article_id
        WHERE po.direction IN ('bullish', 'bearish')
          AND po.confidence IS NOT NULL
          AND ${CONFIDENCE_PCT} BETWEEN 0 AND 100
          AND ${DATE_MATCH}
          AND EXISTS (
            SELECT 1 FROM jsonb_each(po.intervals_json::jsonb) AS interval
            WHERE jsonb_typeof(interval.value -> 'change_pct') = 'number'
          )
      ), series AS (
        SELECT cp.direction, cp.confidence_bin, dp.day_index,
          count(*)::integer AS samples, avg(dp.change_pct) AS average_movement_pct
        FROM chart_predictions cp
        INNER JOIN prediction_daily_points_v2 dp ON dp.outcome_id = cp.id
        GROUP BY cp.direction, cp.confidence_bin, dp.day_index
      ), coverage AS (
        SELECT coalesce(max(greatest(0, floor(extract(epoch FROM (CURRENT_TIMESTAMP - cp.prediction_at)) / 86400))), 0)::integer AS oldest_age_days,
          count(DISTINCT cp.id)::integer AS eligible_predictions,
          count(DISTINCT dp.outcome_id)::integer AS daily_predictions
        FROM chart_predictions cp
        LEFT JOIN prediction_daily_points_v2 dp ON dp.outcome_id = cp.id
      )
      SELECT json_build_object(
        'series', coalesce((SELECT json_agg(json_build_object(
          'direction', direction,
          'confidence_bin', confidence_bin,
          'day_index', day_index,
          'samples', samples,
          'average_movement_pct', average_movement_pct
        ) ORDER BY day_index, direction, confidence_bin) FROM series), '[]'::json),
        'coverage', (SELECT row_to_json(coverage) FROM coverage)
      ) AS payload
    `);
    const payload = result.rows[0]?.payload || {};
    const value = {
      series: payload.series || [],
      coverage: payload.coverage || { oldest_age_days: 0, eligible_predictions: 0, daily_predictions: 0 },
    };
    dailyCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  }

  async function page(url, requestedLimit = 25) {
    const filters = filtersFromUrl(url);
    const limit = Math.min(Math.max(Number(requestedLimit) || 25, 10), 100);
    const offset = decodeCursor(filters.cursor, filters.sort);
    const where = whereForFilters(filters);
    const countResult = await pool.query(`
      SELECT count(*)::integer AS count
      FROM prediction_outcomes po
      INNER JOIN research_results rr ON rr.id = po.result_id
      LEFT JOIN articles a ON a.id = rr.article_id
      WHERE ${where.sql}
    `, where.values);

    const limitParameter = where.values.length + 1;
    const offsetParameter = where.values.length + 2;
    let result;
    if (filters.sort === "newest" || filters.sort === "oldest") {
      const direction = filters.sort === "oldest" ? "ASC" : "DESC";
      result = await pool.query(`
        WITH filtered_ids AS MATERIALIZED (
          SELECT po.id, po.article_id,
            max(po.prediction_at) OVER (PARTITION BY po.article_id) AS latest_prediction_at
          FROM prediction_outcomes po
          INNER JOIN research_results rr ON rr.id = po.result_id
          LEFT JOIN articles a ON a.id = rr.article_id
          WHERE ${where.sql}
        ), page_ids AS MATERIALIZED (
          SELECT id, article_id, latest_prediction_at
          FROM filtered_ids
          ORDER BY latest_prediction_at ${direction}, article_id ${direction}, id ${direction}
          LIMIT $${limitParameter} OFFSET $${offsetParameter}
        )
        SELECT po.*,
          current_point.price AS current_price,
          current_point.sampled_at AS current_price_at,
          current_point.change_pct AS current_movement_pct,
          peak_point.change_pct AS peak_movement_pct,
          coalesce(points.daily_points, '[]'::json) AS daily_points
        FROM page_ids
        INNER JOIN prediction_outcomes po ON po.id = page_ids.id
        LEFT JOIN LATERAL (
          SELECT price, sampled_at, change_pct
          FROM prediction_daily_points_v2
          WHERE outcome_id = po.id
          ORDER BY day_index DESC LIMIT 1
        ) current_point ON true
        LEFT JOIN LATERAL (
          SELECT change_pct
          FROM prediction_daily_points_v2
          WHERE outcome_id = po.id
          ORDER BY abs(change_pct) DESC, day_index DESC LIMIT 1
        ) peak_point ON true
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object(
            'day_index', day_index,
            'at', sampled_at,
            'price', price,
            'change_pct', change_pct
          ) ORDER BY day_index) AS daily_points
          FROM prediction_daily_points_v2
          WHERE outcome_id = po.id
        ) points ON true
        ORDER BY page_ids.latest_prediction_at ${direction}, page_ids.article_id ${direction}, po.id ${direction}
      `, [...where.values, limit + 1, offset]);
    } else {
      result = await pool.query(`
        WITH filtered AS MATERIALIZED (
        SELECT po.*
        FROM prediction_outcomes po
        INNER JOIN research_results rr ON rr.id = po.result_id
        LEFT JOIN articles a ON a.id = rr.article_id
        WHERE ${where.sql}
      ), enriched AS MATERIALIZED (
        SELECT filtered.*,
          current_point.price AS current_price,
          current_point.sampled_at AS current_price_at,
          current_point.change_pct AS current_movement_pct,
          peak_point.change_pct AS peak_movement_pct,
          coalesce(points.daily_points, '[]'::json) AS daily_points
        FROM filtered
        LEFT JOIN LATERAL (
          SELECT price, sampled_at, change_pct
          FROM prediction_daily_points_v2
          WHERE outcome_id = filtered.id
          ORDER BY day_index DESC LIMIT 1
        ) current_point ON true
        LEFT JOIN LATERAL (
          SELECT change_pct
          FROM prediction_daily_points_v2
          WHERE outcome_id = filtered.id
          ORDER BY abs(change_pct) DESC, day_index DESC LIMIT 1
        ) peak_point ON true
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object(
            'day_index', day_index,
            'at', sampled_at,
            'price', price,
            'change_pct', change_pct
          ) ORDER BY day_index) AS daily_points
          FROM prediction_daily_points_v2
          WHERE outcome_id = filtered.id
        ) points ON true
      ), gm AS (
        SELECT article_id, max(prediction_at) AS latest_prediction_at,
          max(current_movement_pct) AS current_max,
          min(current_movement_pct) AS current_min,
          max(peak_movement_pct) AS peak_max,
          min(peak_movement_pct) AS peak_min
        FROM enriched
        GROUP BY article_id
      )
      SELECT enriched.*
      FROM enriched
      INNER JOIN gm ON gm.article_id = enriched.article_id
      ORDER BY ${orderForSort(filters.sort)}
        LIMIT $${limitParameter} OFFSET $${offsetParameter}
      `, [...where.values, limit + 1, offset]);
    }

    const hasMore = result.rows.length > limit;
    const outcomes = result.rows.slice(0, limit).map(outcomeFromRow);
    return {
      outcomes,
      next_cursor: hasMore && outcomes.length ? encodeCursor(offset + outcomes.length, filters.sort) : null,
      has_more: hasMore,
      total: Number(countResult.rows[0]?.count || 0),
    };
  }

  return { coverage, daily, page, summary };
}
