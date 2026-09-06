# Rare Air — historical NBA curiosities

Personal site at **https://cartdotcom.com/backend/nba/**. A standalone Worker
owns only `/backend/nba` and `/backend/nba/*`, leaving the existing Pages
deployment intact. Every asset request checks the existing Cartdotcom backend
session through `/api/auth/session`. No new login, paid subscription, database,
R2 bucket, public dataset endpoint or LLM API is required.

## First version

- 4,726 players, 1,417,329 recorded appearances and 45,507 age/season aggregates.
- Seasons ending 1950–2025; **coverage varies and is not complete NBA history**.
- 1,277 predefined combinations examined offline; 259 deduplicated discoveries.
- One to three independently editable conditions: points, rebounds, assists,
  steals, blocks and threes; arbitrary age ranges and thresholds; playoff or
  regular season; season range; per-game averages or totals.
- Qualify in at least one season/run, or pool every selected game in an age range.
- Interactive exclusive Venn regions, name filter, exact supporting totals and
  appearances, every qualifying season, CSV export and shareable filter links.
- Every recorded appearance counts, including one-game achievements. No
  minimum-games filter. DNP and ambiguous zero-minute entries are audited.
- Default example: LeBron James alone matches 25+ playoff PPG in his 20s, 30s and
  40s **in this dataset**. The 2025 evidence is 127 points / 5 games = 25.4 PPG.

The archive supports the example; it does not certify all-time exclusivity.
For example, the 2025 regular-season portion contains 1,223 games rather than
the full scheduled 1,230. Early seasons are more incomplete. The UI explicitly
shows archive coverage and calls findings dataset-relative.

## Source and calculations

Source: [Eoin A. Moore's historical NBA box-score archive](https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores),
derived from NBA.com. Downloaded September 6, 2026 with the public Kaggle download
endpoint; no account, purchase or subscription was used. Preserve the original
ZIP and its SHA-256. Source files used: Players.csv, PlayerStatistics.csv,
Games.csv. Raw data is neither committed to Git nor uploaded to Cloudflare.

`pipeline/build_snapshot.py` streams the ZIP using the Python standard library.
Each output row records player, season-ending year, competition, age, appearances
and counting-stat totals. `public/engine.js` is used by both the browser and the
offline catalogue generator, avoiding divergent definitions.

- NBA game IDs identify the season and competition, including the delayed 2020
  playoffs. Cup games that count in the regular season are included; the Cup
  final, play-in, preseason, All-Star, ABA and BAA games are excluded.
- Age is completed years on the US Eastern game date in the source. A birthday
  crossing an age bracket splits the season. The per-run mode therefore refers
  to the age-eligible portion of the run, which is stated in the interface.
- Season mode sums all eligible ages **within a season** before comparing.
  Pooled mode divides the sum of counting statistics by total appearances,
  rather than averaging season averages. Totals mode does not divide.
- Comparisons use totals against threshold × games, not rounded display values.
- Unknown statistics propagate through an aggregate. Unknown age cannot qualify
  for an age bracket. Pre-1951 rebounds, pre-1974 steals/blocks and pre-1980
  threes are masked rather than treated as zero.
- Any positive recorded minutes counts, including a single second. Historical
  missing-minute rows with a populated points cell are retained. Explicit
  zero-minute rows need a recorded statistic to establish participation; empty
  all-zero rows and DNP comments are excluded and counted in the audit.
- Each player's membership in a condition is independent: multiple conditions
  may be satisfied in different seasons. These are career membership overlaps,
  not necessarily simultaneous performances in one run.
- Discovery thresholds and age families are declared in the engine and generator.
  Findings are descriptive, not significance tests or performance predictions.

The coverage table reconciles player points with game scores **from the same
archive**. Score agreement is a useful integrity check, not independent proof of
complete coverage or of every player's age, rebounds, assists, steals or blocks.

## Server storage and execution

Owner: lucaj. Application root: `/srv/codex-lab/nba-curiosities`, inside the
existing writable application area. This follows the platform's isolation rules
without requiring a new privileged `/srv` directory or touching shared services.

```
raw/box-scores.zip       Original source archive, approximately 1.0 GiB
output/snapshot.json     Compact aggregates, approximately 1.9 MB
output/discoveries.json  Computed catalogue, approximately 89 KB
backups/                Timestamped snapshot bundles
pipeline/               Build, discovery, validation and rebuild scripts
public/engine.js         Shared analysis engine
compose.yaml            Separate project with resource limits
```

Two finite, manual Compose jobs run sequentially, with no host ports and no
network access. Build: 1 CPU, 1,400 MB RAM, 64 PIDs. Discovery: 1 CPU, 512 MB RAM,
64 PIDs. They use separate containers with no shared platform networks. Image
digests are pinned. There is no persistent server process, scheduled poll or
new ingress route; restart policy is `no` for these batch jobs.

From the application directory on the server:

```sh
sh pipeline/rebuild.sh
python3 pipeline/verify.py
```

The rebuild snapshots the previous outputs, generates both artifacts, and checks
their version and source identity. Failed commands exit nonzero and stop the
process. Nothing automatically publishes partial results. Manual operation means
there is no background failure notifier or freshness SLA. The read-only verify
script is the batch job's health check; a permanently running health endpoint
would serve no purpose here.

To refresh source data deliberately, download the public archive to a temporary
filename, validate it with `python3 -m zipfile -t`, retain the old archive, then
replace `raw/box-scores.zip`. The build defaults to seasons ending through 2025;
change the declared cutoff deliberately if extending history.

## Backup, restore and recovery

The raw archive is immutable input. Snapshot bundles are local backups, not
off-site disaster recovery. The initial bundle was opened and its two JSON
documents validated after creation.

```sh
tar -czf backups/manual-snapshot.tar.gz output/snapshot.json output/discoveries.json
mkdir -p restore-check
tar -xzf backups/manual-snapshot.tar.gz -C restore-check
```

Verify restored JSON identities before copying both restored files into `output`.
If a build fails, the live Cloudflare version stays available. Rerun from the raw
archive after resolving the error, or republish the previous snapshot. The server
can be offline while the deployed interface and snapshot remain usable.

## Local development and publication

From `deployment/nba-curiosities` in the repository:

```powershell
npm ci
scp cartdotcom-server:/srv/codex-lab/nba-curiosities/output/snapshot.json public/snapshot.json
scp cartdotcom-server:/srv/codex-lab/nba-curiosities/output/discoveries.json public/discoveries.json
Copy-Item .dev.vars.example .dev.vars
npm run dev
```

Open `http://127.0.0.1:8795/backend/nba/`. The **ignored, local-only** `.dev.vars`
sets `NBA_LOCAL_DEV=true`; this is never present in production configuration.
Without that flag, authentication always fails closed when the existing session
service cannot verify a login. Never add the flag as a deployed secret or variable.

```powershell
npm test
python -m unittest discover -s pipeline -p 'test_*.py'
npm run check
npm run deploy
```

On this Windows host, the environment's Cloudflare token is Pages-scoped and
cannot deploy Workers. `./deploy.ps1` temporarily uses the existing encrypted
Wrangler OAuth login instead, restoring the process environment afterward.
It neither creates credentials nor changes account permissions.

Only the allowlisted contents of `public/` are uploaded as static assets, together
with the small authentication Worker. Both generated JSON files are ignored by
Git. A deployment uploads the artifacts together. The browser rejects mismatched
timestamps or source identities. CSS/JS contain no credentials. Authenticated
responses are private/no-store, while data stays in browser memory for subsequent
filter changes; no analysis request is needed when changing filters.

Rollback: use `npx wrangler rollback` from this directory to restore the previous
Worker version and assets. A first-deployment rollback can remove only the two
new NBA route entries through Cloudflare, preserving all existing project routes.

## Verification performed

- 14 Node tests: weighting, partial seasons, birthdays, missing data, one-game
  eligibility, unrounded comparisons, Venn partitions, totals, default LeBron
  evidence, authenticated access, denied access and fail-closed behaviour.
- Four Python tests: game-ID classification, birthday boundary, participation and
  unknown values.
- Wrangler deployment dry run and generated runtime binding types.
- Browser checks: default and pooled results, region selection, name filtering,
  desktop/mobile layouts, saved-view links and CSV export. The downloaded CSV
  was inspected. No console errors observed.
- Server snapshot identity check, Compose validation and snapshot backup restore
  content verification.

## Changelog

2026-09-06: Initial historical snapshot, discovery pipeline, private NBA route and
Rare Air interface. No natural-language search or paid services added.

Initial deployed Worker version: `4f251f1a-f3f1-4af2-97a8-7be1eae8134f`.
Live checks confirmed HTML redirects to the existing login, unauthenticated JSON
returns 401, and the only production binding is ASSETS. An authenticated live
browser session was not available; authenticated rendering was tested locally
and session forwarding was covered by the Worker tests.
