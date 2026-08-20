const HOUR_MS = 60 * 60 * 1000;

export function utcHourStart(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("A valid discovery time is required for source metrics.");
  return new Date(Math.floor(timestamp / HOUR_MS) * HOUR_MS);
}

export async function refreshSourceHourlyMetric(client, discoveredAt) {
  const hourStart = utcHourStart(discoveredAt);
  await client.query(
    `INSERT INTO source_hourly_metrics
       (hour_start, article_count, ticker_count, updated_at)
     SELECT $1, count(DISTINCT articles.id)::integer,
            count(predictions.id)::integer, CURRENT_TIMESTAMP
     FROM articles
     LEFT JOIN LATERAL (
       SELECT id FROM research_results
       WHERE research_results.article_id = articles.id
       ORDER BY research_results.created_at DESC
       LIMIT 1
     ) AS latest_result ON true
     LEFT JOIN prediction_outcomes AS predictions
       ON predictions.result_id = latest_result.id
     WHERE articles.discovered_at >= $1
       AND articles.discovered_at < $1 + interval '1 hour'
     ON CONFLICT (hour_start) DO UPDATE SET
       article_count = EXCLUDED.article_count,
       ticker_count = EXCLUDED.ticker_count,
       updated_at = CURRENT_TIMESTAMP`,
    [hourStart],
  );
}
