BEGIN;

INSERT INTO source_hourly_metrics
  (hour_start, article_count, ticker_count, updated_at)
SELECT date_trunc('hour', articles.discovered_at),
       count(DISTINCT articles.id)::integer,
       count(predictions.id)::integer,
       CURRENT_TIMESTAMP
FROM articles
LEFT JOIN LATERAL (
  SELECT id FROM research_results
  WHERE research_results.article_id = articles.id
  ORDER BY research_results.created_at DESC
  LIMIT 1
) AS latest_result ON true
LEFT JOIN prediction_outcomes AS predictions
  ON predictions.result_id = latest_result.id
WHERE articles.discovered_at >= timestamptz '2026-07-18T08:28:55Z'
GROUP BY date_trunc('hour', articles.discovered_at)
ON CONFLICT (hour_start) DO UPDATE SET
  article_count = EXCLUDED.article_count,
  ticker_count = EXCLUDED.ticker_count,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO source_metric_state (key, completed_at)
VALUES ('self_hosted_ticker_metrics_v1', CURRENT_TIMESTAMP)
ON CONFLICT (key) DO UPDATE SET completed_at = EXCLUDED.completed_at;

COMMIT;
