import { createHash } from "node:crypto";
import {
  analyse,
  defaults,
  evaluateRing,
  registerMetrics,
  METRICS,
  ringLabel,
} from "../public/engine.js";

export const FAMILIES = {
  longevity: "Across the ages",
  "same-season": "In the same season",
  "career-overlap": "Career intersections",
  milestone: "Cumulative milestones",
  "rare-category": "Small clubs",
};
export function thresholds(values, step = 1, measure = "average") {
  const sorted = values
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return [];
  function round(value) {
    if (measure === "average")
      return Math.max(step, Math.ceil(value / step) * step);
    const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
    return [1, 2, 5, 10].map((x) => x * power).find((x) => x >= value);
  }
  return [
    ...new Set(
      [0.65, 0.8, 0.9, 0.96, 0.99, 0.999].map((q) =>
        round(
          sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))],
        ),
      ),
    ),
  ].filter((n) => n <= sorted.at(-1));
}
function intersect(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  return new Set([...a].filter((x) => b.has(x)));
}
function playerSet(entities) {
  return [
    ...new Set([...entities].map((s) => Number(String(s).split(":")[0]))),
  ].sort((a, b) => a - b);
}
function disjoint(a, b) {
  return a.maxAge < b.minAge || b.maxAge < a.minAge;
}
function stableId(query) {
  return createHash("sha256")
    .update(JSON.stringify(query))
    .digest("hex")
    .slice(0, 18);
}

export function mine(
  snapshot,
  {
    first = snapshot.firstSeason,
    last = snapshot.lastSeason,
    maxTriples = 15000,
  } = {},
) {
  registerMetrics(snapshot);
  const bySignature = new Map();
  const stats = {
    evaluated: 0,
    atomicConditions: 0,
    redundantRejected: 0,
    emptyRejected: 0,
    sameSeasonEvaluated: 0,
    tripleBudgetPerContext: maxTriples,
  };
  const ages = [
    [15, 60],
    [15, 19],
    [20, 29],
    [30, 39],
    [40, 49],
    [20, 24],
    [25, 29],
    [30, 34],
    [35, 39],
  ];
  const base = { ...defaults(), first, last };
  function consider(query, atoms, entities, family, allowRedundant = false) {
    stats.evaluated++;
    if (query.scope === "same-season") stats.sameSeasonEvaluated++;
    const players = playerSet(entities);
    if (!players.length) {
      stats.emptyRejected++;
      return;
    }
    if (players.length > 5) return;
    const parentCounts = atoms.map((a) => a.players.size);
    if (
      !allowRedundant &&
      atoms.length > 1 &&
      Math.min(...parentCounts) <= players.length
    ) {
      stats.redundantRejected++;
      return;
    }
    const sig = JSON.stringify([
      query.type,
      query.mode,
      query.measure,
      query.scope,
      first,
      last,
      family,
      players,
      atoms.map((a) => [a.ring.metric, a.ring.minAge, a.ring.maxAge]).sort(),
    ]);
    const reduction =
      atoms.length > 1 ? Math.min(...parentCounts) / players.length : 1;
    const score =
      80 / players.length +
      12 * Math.log2(Math.max(1, reduction)) +
      (family === "same-season" ? 15 : 0) +
      (family === "longevity" ? 12 : 0) -
      (atoms.length - 1) * 4;
    if (bySignature.has(sig) && bySignature.get(sig).score >= score) return;
    let smallestSample = Infinity;
    for (const atom of atoms)
      for (const p of players)
        for (const g of atom.evidence.get(p) || []) {
          if (query.scope !== "same-season" || entities.has(`${p}:${g.season}`))
            smallestSample = Math.min(smallestSample, g.games);
        }
    bySignature.set(sig, {
      id: stableId(query),
      query,
      family,
      players,
      count: players.length,
      labels: query.rings.map((r) => ringLabel(r, query.measure)),
      metrics: [...new Set(atoms.map((a) => a.ring.metric))],
      parentCounts,
      reduction,
      smallestSample,
      score,
      scopeLabel:
        query.mode === "pooled"
          ? "All selected games pooled"
          : query.scope === "same-season"
            ? "All conditions in the same season"
            : "Conditions may be met in different seasons",
      sameSeasons:
        query.scope === "same-season"
          ? [
              ...new Set([...entities].map((e) => Number(e.split(":")[1]))),
            ].sort()
          : [],
    });
  }
  for (const type of [1, 0])
    for (const mode of ["season", "pooled"])
      for (const measure of ["average", "total"]) {
        const queryBase = { ...base, type, mode, measure, scope: "career" },
          atoms = [];
        for (const [minAge, maxAge] of ages)
          for (const [metric, info] of Object.entries(METRICS)) {
            if (!snapshot.columns.includes(metric) || last < info.start)
              continue;
            const ring = {
              metric,
              threshold: 0,
              minAge,
              maxAge,
              enabled: true,
            };
            const all = evaluateRing(snapshot, queryBase, ring);
            const levels = thresholds(
              [...all.best.values()].map((g) => g.value),
              info.step || 1,
              measure,
            );
            // This familiar comparison is evaluated, never assigned a seeded winner.
            if (
              metric === "pts" &&
              measure === "average" &&
              !levels.includes(25)
            )
              levels.push(25);
            for (const threshold of levels.sort((a, b) => a - b)) {
              const evidence = new Map();
              for (const [p, groups] of all.members) {
                const matches = groups.filter(
                  (g) =>
                    g.total >= threshold * (measure === "total" ? 1 : g.games),
                );
                if (matches.length) evidence.set(p, matches);
              }
              const players = new Set(evidence.keys());
              if (!players.size) continue;
              const atom = {
                ring: { ...ring, threshold },
                players,
                evidence,
                entities: new Set([...players].map(String)),
              };
              atoms.push(atom);
              stats.atomicConditions++;
              consider(
                { ...queryBase, rings: [atom.ring] },
                [atom],
                atom.entities,
                measure === "total" ? "milestone" : "rare-category",
              );
            }
          }
        for (let i = 0; i < atoms.length; i++)
          for (let j = i + 1; j < atoms.length; j++) {
            const a = atoms[i],
              b = atoms[j];
            if (a.ring.metric === b.ring.metric) {
              if (
                !disjoint(a.ring, b.ring) ||
                a.ring.threshold !== b.ring.threshold
              )
                continue;
              const entities = intersect(a.entities, b.entities);
              consider(
                { ...queryBase, rings: [a.ring, b.ring] },
                [a, b],
                entities,
                "longevity",
                true,
              );
              for (let k = j + 1; k < atoms.length; k++) {
                const c = atoms[k];
                if (
                  c.ring.metric !== a.ring.metric ||
                  c.ring.threshold !== a.ring.threshold ||
                  !disjoint(a.ring, c.ring) ||
                  !disjoint(b.ring, c.ring)
                )
                  continue;
                consider(
                  { ...queryBase, rings: [a.ring, b.ring, c.ring] },
                  [a, b, c],
                  intersect(entities, c.entities),
                  "longevity",
                  true,
                );
              }
            } else if (
              a.ring.minAge === b.ring.minAge &&
              a.ring.maxAge === b.ring.maxAge
            ) {
              consider(
                { ...queryBase, rings: [a.ring, b.ring] },
                [a, b],
                intersect(a.entities, b.entities),
                measure === "total" ? "milestone" : "career-overlap",
              );
            }
          }
        if (mode !== "season") continue;
        // Player-season intersections prove simultaneity; player intersections alone do not.
        const seasonAtoms = atoms.map((a) => ({
          ...a,
          entities: new Set(
            [...a.evidence].flatMap(([p, gs]) =>
              gs.map((g) => `${p}:${g.season}`),
            ),
          ),
        }));
        const extensions = [];
        for (let i = 0; i < seasonAtoms.length; i++)
          for (let j = i + 1; j < seasonAtoms.length; j++) {
            const a = seasonAtoms[i],
              b = seasonAtoms[j];
            if (
              a.ring.metric === b.ring.metric ||
              a.ring.minAge !== b.ring.minAge ||
              a.ring.maxAge !== b.ring.maxAge
            )
              continue;
            const entities = intersect(a.entities, b.entities);
            consider(
              { ...queryBase, scope: "same-season", rings: [a.ring, b.ring] },
              [a, b],
              entities,
              "same-season",
            );
            const n = playerSet(entities).length;
            if (n > 5 && n <= 30) extensions.push({ i, j, entities, n });
          }
        extensions.sort((a, b) => a.n - b.n || a.i - b.i || a.j - b.j);
        let tripleCount = 0;
        for (const pair of extensions) {
          if (tripleCount >= maxTriples) break;
          const a = seasonAtoms[pair.i],
            b = seasonAtoms[pair.j];
          for (
            let k = pair.j + 1;
            k < seasonAtoms.length && tripleCount < maxTriples;
            k++
          ) {
            const c = seasonAtoms[k];
            if (
              c.ring.metric === a.ring.metric ||
              c.ring.metric === b.ring.metric ||
              a.ring.minAge !== c.ring.minAge ||
              a.ring.maxAge !== c.ring.maxAge
            )
              continue;
            tripleCount++;
            const entities = intersect(pair.entities, c.entities),
              n = playerSet(entities).length;
            if (
              n &&
              n <= 5 &&
              (playerSet(intersect(a.entities, c.entities)).length <= n ||
                playerSet(intersect(b.entities, c.entities)).length <= n)
            ) {
              stats.redundantRejected++;
              continue;
            }
            consider(
              {
                ...queryBase,
                scope: "same-season",
                rings: [a.ring, b.ring, c.ring],
              },
              [a, b, c],
              entities,
              "same-season",
            );
          }
        }
      }
  return { findings: [...bySignature.values()], stats };
}
export function diversify(findings, limit = 2400) {
  const remaining = [...findings].sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  );
  const selected = [],
    usedPlayers = new Map(),
    usedFamilies = new Map(),
    usedMetrics = new Map();
  while (remaining.length && selected.length < limit) {
    let best = 0,
      bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const f = remaining[i],
        penalty =
          12 * Math.max(...f.players.map((p) => usedPlayers.get(p) || 0)) +
          4 * (usedFamilies.get(f.family) || 0) +
          2 * Math.max(...f.metrics.map((m) => usedMetrics.get(m) || 0));
      if (f.score - penalty > bestScore) {
        bestScore = f.score - penalty;
        best = i;
      }
    }
    const f = remaining.splice(best, 1)[0];
    selected.push(f);
    f.players.forEach((p) => usedPlayers.set(p, (usedPlayers.get(p) || 0) + 1));
    usedFamilies.set(f.family, (usedFamilies.get(f.family) || 0) + 1);
    f.metrics.forEach((m) => usedMetrics.set(m, (usedMetrics.get(m) || 0) + 1));
  }
  return selected;
}
export function verifyFinding(snapshot, finding) {
  return (
    JSON.stringify(
      analyse(snapshot, finding.query).intersection.sort((a, b) => a - b),
    ) === JSON.stringify(finding.players)
  );
}
