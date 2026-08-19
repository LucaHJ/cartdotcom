import assert from "node:assert/strict";
import { baselinePoint, buildIntervals, fetchYahooChart } from "./prices.js";

const predictionAt = new Date(Date.now() - 7 * 86400000).toISOString();
const [shortChart, longChart] = await Promise.all([
  fetchYahooChart("NVDA", predictionAt, "1h", 60 * 86400),
  fetchYahooChart("NVDA", predictionAt, "1d", 4 * 365 * 86400),
]);
const baseline = baselinePoint(shortChart, longChart, predictionAt);
assert.ok(baseline?.price > 0, "Yahoo returned no usable NVDA baseline.");
const intervals = buildIntervals({ predictionAt, direction: "bullish", baseline, shortChart, longChart });
assert.ok(intervals["12h"].price > 0, "Yahoo returned no elapsed 12-hour price.");
console.log(JSON.stringify({
  ok: true,
  symbol: "NVDA",
  baseline_price: baseline.price,
  baseline_at: new Date(baseline.at * 1000).toISOString(),
  elapsed_12h_price: intervals["12h"].price,
  elapsed_12h_at: intervals["12h"].at,
}));
