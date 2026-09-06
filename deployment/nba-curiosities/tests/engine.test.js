import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { analyse, defaults, validateQuery } from "../public/engine.js";

const data = (rows) => ({
  firstSeason: 1950,
  lastSeason: 2025,
  players: [
    ["1", "One"],
    ["2", "Two"],
  ],
  rows,
});
const row = (p, y, age, g, pts, reb = 0) => [
  p,
  y,
  1,
  age,
  g,
  pts,
  reb,
  0,
  0,
  0,
  0,
];
const q = (extra = {}) => ({
  ...defaults(),
  rings: [
    { metric: "pts", threshold: 25, minAge: 20, maxAge: 29, enabled: true },
  ],
  ...extra,
});

test("a single appearance qualifies; no minimum games cutoff", () => {
  assert.deepEqual(analyse(data([row(0, 2020, 25, 1, 25)]), q()).intersection, [
    0,
  ]);
});
test("pooled averages are weighted by appearances, not season averages", () => {
  const d = data([row(0, 2020, 25, 1, 40), row(0, 2021, 26, 9, 180)]);
  assert.deepEqual(analyse(d, q()).intersection, [0]);
  const pooled = analyse(d, q({ mode: "pooled" }));
  assert.deepEqual(pooled.intersection, []);
  assert.equal(pooled.rings[0].best.get(0).value, 22);
});
test("age-specific rows in one bracket combine within a season", () => {
  const d = data([row(0, 2020, 25, 2, 70), row(0, 2020, 26, 2, 10)]);
  assert.deepEqual(analyse(d, q()).intersection, []);
});
test("birthday at bracket boundary splits games", () => {
  const d = data([row(0, 2020, 29, 2, 70), row(0, 2020, 30, 2, 10)]);
  assert.equal(analyse(d, q()).rings[0].best.get(0).value, 35);
});
test("missing values and age cannot become zero or qualify", () => {
  const d = data([
    row(0, 2020, 25, 1, null),
    row(0, 2021, 26, 1, 50),
    row(1, 2020, null, 1, 50),
  ]);
  assert.deepEqual(analyse(d, q({ mode: "pooled" })).intersection, []);
  assert.deepEqual(analyse(d, q()).intersection, [0]);
});
test("rounding does not turn 24.999 into a 25-point qualifier", () => {
  assert.deepEqual(
    analyse(data([row(0, 2020, 25, 1000, 24999)]), q()).intersection,
    [],
  );
});
test("Venn regions partition the union; different runs may satisfy different conditions", () => {
  const d = data([
    row(0, 2020, 29, 1, 30),
    row(0, 2021, 30, 1, 30),
    row(1, 2020, 29, 1, 30),
  ]);
  const query = q({
    rings: [20, 30].map((minAge) => ({
      metric: "pts",
      threshold: 25,
      minAge,
      maxAge: minAge + 9,
      enabled: true,
    })),
  });
  const r = analyse(d, query);
  assert.deepEqual(r.regions[1], [1]);
  assert.deepEqual(r.regions[3], [0]);
  assert.equal(r.regions.flat().length, r.union.length);
});
test("totals, disabled conditions and season filters are respected", () => {
  const d = data([row(0, 2020, 25, 10, 100), row(1, 2021, 25, 10, 100)]);
  assert.deepEqual(
    analyse(d, q({ measure: "total", last: 2020 })).intersection,
    [0],
  );
  assert.throws(() => validateQuery(q({ first: 2025, last: 2000 }), d));
  assert.throws(() =>
    validateQuery(q({ rings: [{ ...q().rings[0], enabled: false }] }), d),
  );
});
test(
  "snapshot: LeBron is the sole default triple intersection; 2025 is 127/5",
  { skip: !fs.existsSync("public/snapshot.json") },
  () => {
    const d = JSON.parse(fs.readFileSync("public/snapshot.json"));
    const r = analyse(d, defaults());
    assert.deepEqual(
      r.intersection.map((p) => d.players[p][0]),
      ["2544"],
    );
    const lebron = r.intersection[0];
    const evidence = r.rings[2].members
      .get(lebron)
      .find((g) => g.season === 2025);
    assert.equal(evidence.games, 5);
    assert.equal(evidence.total, 127);
    assert.equal(evidence.value, 25.4);
    assert.deepEqual([...r.rings[2].members.keys()], [lebron]);
  },
);
