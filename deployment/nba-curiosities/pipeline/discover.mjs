import fs from "node:fs";
import path from "node:path";
import { mine, diversify, verifyFinding, FAMILIES } from "./miner.mjs";
const dir = process.argv[2] || "public";
const snapshot = JSON.parse(
  fs.readFileSync(path.join(dir, "snapshot.json"), "utf8"),
);
const archivePath = path.join(dir, "discovery-archive.json");
const previous = fs.existsSync(archivePath)
  ? JSON.parse(fs.readFileSync(archivePath, "utf8"))
  : null;
const ruleVersion = "2.0.0";
const compatible =
  previous?.snapshotGeneratedAt === snapshot.generatedAt &&
  previous?.ruleVersion === ruleVersion;
const pass = compatible ? previous.pass + 1 : 0,
  windows = [];
for (
  let first = snapshot.firstSeason;
  first <= snapshot.lastSeason;
  first += 10
)
  windows.push([first, Math.min(first + 9, snapshot.lastSeason)]);
const window = windows[pass % windows.length];
console.log(
  `Mining full history and seasons ending ${window.join("-")} across ${snapshot.metrics?.length || 6} statistics`,
);
const all = mine(snapshot),
  era = mine(snapshot, { first: window[0], last: window[1], maxTriples: 4000 });
const now = new Date().toISOString(),
  merged = new Map();

for (const f of compatible ? previous.findings : []) merged.set(f.id, f);
for (const f of [...all.findings, ...era.findings])
  merged.set(f.id, { ...f, firstSeen: merged.get(f.id)?.firstSeen || now });
const findings = [...merged.values()],
  published = diversify(findings);
for (const f of published)
  if (!verifyFinding(snapshot, f))
    throw Error(`Evidence verification failed for ${f.id}`);
const report = {
  version: 2,
  ruleVersion,
  pass,
  generatedAt: snapshot.generatedAt,
  analysedAt: now,
  snapshotGeneratedAt: snapshot.generatedAt,
  snapshotSha256: snapshot.source.sha256,
  evaluated: all.stats.evaluated + era.stats.evaluated,
  totalDiscovered: findings.length,
  newFindings: findings.filter((f) => f.firstSeen === now).length,
  familyLabels: FAMILIES,
  stats: { fullHistory: all.stats, era: era.stats },
  nextEra: windows[(pass + 1) % windows.length],
  schedule: "Daily at 04:20 UTC - full history plus a rotating decade",
  note: "Distribution-derived thresholds across every registered statistic; career, age, cumulative and same-season intersections. Same-season triples must add information beyond their pairs. Ranking balances rarity, reduction from parent sets, players, statistics and relationship families. Up to three conditions; the site shows 2,400 diverse findings and the full deduplicated archive stays on the local server. No minimum appearance cutoff or significance claims.",
};
function atomic(file, data) {
  fs.writeFileSync(file + ".tmp", JSON.stringify(data));
  fs.renameSync(file + ".tmp", file);
}
atomic(path.join(dir, "discoveries.json"), { ...report, findings: published });
atomic(archivePath, { ...report, findings });
console.log(
  JSON.stringify({
    evaluated: report.evaluated,
    discovered: findings.length,
    published: published.length,
    new: report.newFindings,
    pass,
  }),
);
