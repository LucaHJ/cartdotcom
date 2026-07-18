CREATE INDEX IF NOT EXISTS idx_prediction_outcomes_symbol_prediction_at_direction
ON prediction_outcomes(symbol, prediction_at, direction);
