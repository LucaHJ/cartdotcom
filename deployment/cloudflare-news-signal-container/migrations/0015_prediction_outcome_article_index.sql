CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_article_prediction_at
ON prediction_outcomes(article_id, prediction_at);
