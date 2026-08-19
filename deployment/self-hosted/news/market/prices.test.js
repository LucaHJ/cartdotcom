import test from "node:test";
import assert from "node:assert/strict";
import { baselinePoint, buildDailyPoints, buildIntervals, nextCheckAt } from "./prices.js";

const base = Date.parse("2026-08-01T00:00:00Z") / 1000;
const chart = { timestamps: [base, base + 43200, base + 86400, base + 172800], closes: [100, 105, 110, 90] };

test("uses the first market point at or after each elapsed target", () => {
  const baseline = baselinePoint(chart, chart, "2026-08-01T00:00:00Z", base + 200000);
  const intervals = buildIntervals({ predictionAt: "2026-08-01T00:00:00Z", direction: "bearish", baseline, shortChart: chart, longChart: chart, now: base + 200000 });
  assert.equal(intervals["12h"].change_pct, 5);
  assert.equal(intervals["48h"].change_pct, -10);
  assert.equal(intervals["48h"].accurate, true);
  assert.equal(intervals["1w"].price, null);
});

test("daily history is monotonic in sample count and carries the latest close", () => {
  const points = buildDailyPoints({ predictionAt: "2026-08-01T00:00:00Z", baseline: { at: base, price: 100 }, chart, now: base + 3 * 86400 });
  assert.deepEqual(points.map((point) => point.day_index), [0, 1, 2, 3]);
  assert.equal(points[3].price, 90);
  assert.ok(Date.parse(nextCheckAt("2026-08-01T00:00:00Z", {}, base + 3 * 86400)) > (base + 3 * 86400) * 1000);
});
