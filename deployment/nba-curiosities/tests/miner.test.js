import test from "node:test";
import assert from "node:assert/strict";
import {
  thresholds,
  mine,
  verifyFinding,
  diversify,
} from "../pipeline/miner.mjs";
test("thresholds are derived from values with legible increments", () => {
  assert.deepEqual(thresholds([], 5), []);
  const levels = thresholds([1, 5, 9, 12, 17, 21, 28, 34], 5);
  assert.ok(levels.length);
  assert.ok(levels.every((n) => n % 5 === 0 && n <= 34));
  assert.ok(
    thresholds([9, 101, 501, 1300, 2600], 1, "total").every(
      (n) => n > 0 && n <= 2600,
    ),
  );
});
test("a new registered statistic is mined without adding a template", () => {
  const snapshot = {
    firstSeason: 2020,
    lastSeason: 2021,
    columns: ["player", "season", "type", "age", "games", "novel"],
    metrics: [
      { id: "novel", label: "New stat", short: "NEW/G", start: 2020, step: 1 },
    ],
    players: Array.from({ length: 8 }, (_, p) => [String(p), "Player " + p]),
    rows: Array.from({ length: 8 }, (_, p) => [p, 2020, 1, 25, 1, p + 1]),
  };
  const result = mine(snapshot, { maxTriples: 10 });
  assert.ok(result.stats.evaluated > 0);
  assert.ok(result.findings.some((f) => f.metrics.includes("novel")));
  assert.ok(result.findings.every((f) => verifyFinding(snapshot, f)));
  assert.ok(result.findings.some((f) => f.smallestSample === 1));
});
test("diversification spreads early cards across players and themes", () => {
  const candidates = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    score: 100,
    players: [i < 6 ? 0 : i],
    metrics: [i < 6 ? "pts" : "reb"],
    family: i < 6 ? "longevity" : "same-season",
  }));
  const out = diversify(candidates, 3);
  assert.equal(new Set(out.flatMap((f) => f.players)).size, 3);
});
