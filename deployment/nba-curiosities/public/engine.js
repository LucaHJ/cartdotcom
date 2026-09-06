export const METRICS = {
  pts: {
    label: "Points",
    short: "PPG",
    column: 5,
    start: 1950,
    thresholds: [20, 25, 30, 35, 40],
  },
  reb: {
    label: "Rebounds",
    short: "RPG",
    column: 6,
    start: 1951,
    thresholds: [5, 10, 15, 20],
  },
  ast: {
    label: "Assists",
    short: "APG",
    column: 7,
    start: 1950,
    thresholds: [5, 8, 10, 12],
  },
  stl: {
    label: "Steals",
    short: "SPG",
    column: 8,
    start: 1974,
    thresholds: [2, 3, 4],
  },
  blk: {
    label: "Blocks",
    short: "BPG",
    column: 9,
    start: 1974,
    thresholds: [2, 3, 4],
  },
  three: {
    label: "Threes made",
    short: "3PM/G",
    column: 10,
    start: 1980,
    thresholds: [2, 3, 4, 5],
  },
};

export function defaults() {
  return {
    type: 1,
    mode: "season",
    measure: "average",
    first: 1950,
    last: 2025,
    rings: [20, 30, 40].map((age) => ({
      metric: "pts",
      threshold: 25,
      minAge: age,
      maxAge: age + 9,
      enabled: true,
    })),
  };
}

export function validateQuery(query, snapshot) {
  if (
    ![0, 1].includes(query.type) ||
    !["season", "pooled"].includes(query.mode) ||
    !["average", "total"].includes(query.measure)
  )
    throw new Error("Invalid calculation options.");
  if (
    ![query.first, query.last].every(Number.isInteger) ||
    query.first < snapshot.firstSeason ||
    query.last > snapshot.lastSeason ||
    query.first > query.last
  )
    throw new Error("Choose a valid season range.");
  if (
    !Array.isArray(query.rings) ||
    query.rings.length < 1 ||
    query.rings.length > 3
  )
    throw new Error("Choose one to three conditions.");
  if (!query.rings.some((r) => r.enabled))
    throw new Error("Enable at least one condition.");
  for (const r of query.rings) {
    if (
      !METRICS[r.metric] ||
      !Number.isFinite(r.threshold) ||
      r.threshold < 0 ||
      r.threshold > 100000 ||
      !Number.isInteger(r.minAge) ||
      !Number.isInteger(r.maxAge) ||
      r.minAge < 15 ||
      r.maxAge > 60 ||
      r.minAge > r.maxAge
    )
      throw new Error(
        "Check each condition: ages 15–60, lower age first, and a nonnegative threshold.",
      );
  }
  return query;
}

export function ringLabel(r, measure = "average") {
  const metric = METRICS[r.metric];
  return `${r.threshold}+ ${measure === "average" ? metric.short : metric.label.toLowerCase()} · ages ${r.minAge}–${r.maxAge}`;
}

export function evaluateRing(snapshot, query, ring) {
  const groups = new Map();
  const column = METRICS[ring.metric].column;
  let unknownAge = 0;
  for (const row of snapshot.rows) {
    const [p, year, type, age, games] = row;
    if (type !== query.type || year < query.first || year > query.last)
      continue;
    if (age === null) {
      unknownAge += games;
      continue;
    }
    if (age < ring.minAge || age > ring.maxAge) continue;
    const key = query.mode === "season" ? `${p}:${year}` : String(p);
    let g = groups.get(key);
    if (!g) {
      g = {
        player: p,
        season: query.mode === "season" ? year : null,
        seasons: [],
        games: 0,
        total: 0,
        minAge: age,
        maxAge: age,
      };
      groups.set(key, g);
    }
    g.games += games;
    g.total =
      g.total === null || row[column] === null ? null : g.total + row[column];
    if (!g.seasons.includes(year)) g.seasons.push(year);
    g.minAge = Math.min(g.minAge, age);
    g.maxAge = Math.max(g.maxAge, age);
  }
  const members = new Map(),
    best = new Map();
  let unknownGroups = 0;
  for (const g of groups.values()) {
    if (g.total === null) {
      unknownGroups++;
      continue;
    }
    g.value = query.measure === "total" ? g.total : g.total / g.games;
    const divisor = query.measure === "total" ? 1 : g.games;
    g.qualifies = g.total >= ring.threshold * divisor;
    if (!best.has(g.player) || best.get(g.player).value < g.value)
      best.set(g.player, g);
    if (g.qualifies) {
      if (!members.has(g.player)) members.set(g.player, []);
      members.get(g.player).push(g);
    }
  }
  for (const evidence of members.values())
    evidence.sort(
      (a, b) => b.value - a.value || (b.season || 0) - (a.season || 0),
    );
  return { members, best, unknownGroups, unknownAge };
}

export function analyse(snapshot, query) {
  validateQuery(query, snapshot);
  const rings = query.rings.map((r) =>
    r.enabled
      ? evaluateRing(snapshot, query, r)
      : {
          members: new Map(),
          best: new Map(),
          unknownGroups: 0,
          unknownAge: 0,
        },
  );
  const maskAll = query.rings.reduce(
    (mask, r, i) => mask | (r.enabled ? 1 << i : 0),
    0,
  );
  const masks = new Map();
  rings.forEach((r, i) =>
    r.members.forEach((_, p) => masks.set(p, (masks.get(p) || 0) | (1 << i))),
  );
  const regions = Array.from({ length: 8 }, () => []);
  masks.forEach((mask, p) => regions[mask].push(p));
  regions.forEach((r) =>
    r.sort((a, b) =>
      snapshot.players[a][1].localeCompare(snapshot.players[b][1]),
    ),
  );
  return {
    rings,
    maskAll,
    masks,
    regions,
    intersection: regions[maskAll],
    union: [...masks.keys()],
  };
}
