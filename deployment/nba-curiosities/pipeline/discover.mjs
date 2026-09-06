import fs from "node:fs";
import path from "node:path";
import { analyse, defaults, METRICS, ringLabel } from "../public/engine.js";

const dir = process.argv[2] || "public";
const snapshot = JSON.parse(
  fs.readFileSync(path.join(dir, "snapshot.json"), "utf8"),
);
const findings = [],
  seen = new Set();
let evaluated = 0;
function consider(query, featured = false) {
  evaluated++;
  const result = analyse(snapshot, query);
  if (!result.intersection.length || result.intersection.length > 5) return;
  const ids = [...result.intersection].sort((a, b) => a - b);
  const signature = `${query.type}:${query.mode}:${query.rings.map((r) => `${r.metric}:${r.minAge}:${r.maxAge}`).join("|")}:${ids.join(",")}`;
  if (seen.has(signature) && !featured) return;
  seen.add(signature);
  findings.push({
    query,
    players: ids,
    count: ids.length,
    featured,
    labels: query.rings.map((r) => ringLabel(r)),
    smallestSample: Math.min(
      ...ids.flatMap((p) =>
        result.rings.flatMap((r) =>
          (r.members.get(p) || []).map((g) => g.games),
        ),
      ),
    ),
  });
}
const base = {
  ...defaults(),
  first: snapshot.firstSeason,
  last: snapshot.lastSeason,
};
consider(base, true);
for (const type of [1, 0])
  for (const mode of ["season", "pooled"]) {
    for (const [metric, info] of Object.entries(METRICS)) {
      for (const threshold of [...info.thresholds].reverse()) {
        for (const ages of [
          [15],
          [20],
          [30],
          [40],
          [20, 30],
          [30, 40],
          [20, 30, 40],
          [15, 20, 30],
        ]) {
          consider({
            ...base,
            type,
            mode,
            rings: ages.map((a) => ({
              enabled: true,
              metric,
              threshold,
              minAge: a,
              maxAge: a === 15 ? 19 : a + 9,
            })),
          });
        }
      }
    }
    // Cross-stat career memberships: each condition may be met in a different run.
    for (const age of [20, 30, 40])
      for (const points of [25, 30, 35])
        for (const metric of ["reb", "ast", "blk", "three"]) {
          for (const threshold of METRICS[metric].thresholds) {
            consider({
              ...base,
              type,
              mode,
              rings: [
                {
                  enabled: true,
                  metric: "pts",
                  threshold: points,
                  minAge: age,
                  maxAge: age + 9,
                },
                {
                  enabled: true,
                  metric,
                  threshold,
                  minAge: age,
                  maxAge: age + 9,
                },
              ],
            });
          }
        }
  }
findings.sort(
  (a, b) =>
    Number(b.featured) - Number(a.featured) ||
    a.count - b.count ||
    a.query.rings.length - b.query.rings.length ||
    b.smallestSample - a.smallestSample,
);
const result = {
  version: 1,
  snapshotSha256: snapshot.source.sha256,
  generatedAt: snapshot.generatedAt,
  evaluated,
  findings,
  note: "Bounded enumeration of declared round-number thresholds, age brackets and cross-stat memberships. Descriptive discoveries, not significance tests. Different conditions may be satisfied in different seasons.",
};
const out = path.join(dir, "discoveries.json");
fs.writeFileSync(out + ".tmp", JSON.stringify(result));
fs.renameSync(out + ".tmp", out);
console.log(
  JSON.stringify({
    evaluated,
    findings: findings.length,
    featured: findings
      .find((f) => f.featured)
      ?.players.map((p) => snapshot.players[p][1]),
  }),
);
