# Rare Air — historical NBA discoveries

Personal site: **https://cartdotcom.com/backend/nba/**. Browse automatically
discovered relationships, then open their evidence. Manual conditions are
secondary, behind **Adjust conditions**. No LLM, paid data subscription or
purchase is required. Existing Cartdotcom backend authentication protects the
page and every data response.

## Automatic discovery

`metrics.json` registers 14 counting statistics: points, rebounds, assists,
steals, blocks, threes made, field goals made, free throws made, offensive and
defensive rebounds, turnovers, personal fouls, field goal attempts and free
throw attempts. Adding a supported source column and its metadata extends the
same discovery engine without writing individual player stories.

The server derives readable thresholds from each statistic's observed
distribution. It searches regular seasons and playoffs, season-level and
pooled values, averages and totals, and several age brackets. Five story
families cover small clubs, cumulative milestones, career intersections,
achievements across ages and simultaneous same-season achievements.

Up to three conditions are combined. Same-season intersections use
**player-season pairs**, so unrelated years cannot create a false match.
Redundant cross-statistic conditions are suppressed; age comparisons retain
overlapping memberships because sustained achievement is itself the story.
Candidate triples and thresholds are bounded: this is a systematic exploration
of defined relationship families, not every possible mathematical relationship.

The first expanded run evaluated 188,761 combinations and retained 34,419
discoveries. Each daily run searches full history plus a rotating decade,
retaining discoveries from previous compatible runs. Duplicate signatures are
collapsed. The browser receives 2,400 findings selected for rarity, reduction
from individual sets, and variety across players, statistics and families.
The full archive remains on the server. Each published result is independently
re-evaluated with the shared browser engine before publication.

The interface supports themes, statistic/player text matching, saved stories
(in that browser), surprise selection, exact evidence, CSV exports and saved
query links. Text matching is not natural-language search. Search timestamps
are visible, with an overdue notice after 48 hours.

## Data and definitions

Source: [Eoin A. Moore's historical NBA box-score archive](https://www.kaggle.com/datasets/eoinamoore/historical-nba-data-and-player-box-scores),
derived from NBA.com. Downloaded September 6, 2026 using the public Kaggle
endpoint. Raw files: Players.csv, PlayerStatistics.csv and Games.csv. The ZIP
and source SHA-256 remain on the server.

The fixed snapshot covers seasons ending **1950–2025**: 4,726 players,
1,417,329 recorded appearances and 45,507 age/season aggregates. Coverage varies
and is **not complete NBA history**. For example, the 2025 regular season has
1,223 recorded games rather than all 1,230. Uniqueness always means uniqueness
within the available archive and displayed conditions. These are descriptive
curiosities, not predictions or significance tests.

- Every actual appearance counts, including a single game. DNP and ambiguous
  zero-minute entries are excluded; a positive minute fraction counts.
- Game IDs determine season and competition, including the delayed 2020
  playoffs. Play-in, preseason, All-Star, ABA and BAA are excluded. Cup games
  counting toward regular standings are included; the Cup final is excluded.
- Age is measured on game day. Birthdays can split a season between brackets.
  Unknown birth dates qualify for unrestricted-age facts, but not age brackets.
- Averages divide totals by appearances, with no rounding before qualification.
  Pooled averages weight every appearance; they do not average season averages.
- Unknown statistics remain unknown and cannot qualify. Historically unavailable
  metrics have conservative start seasons. No missing value is treated as zero.
- Same-season stories require all conditions in a shared season. Career stories
  may satisfy different conditions in different seasons. The evidence and CSV
  identify the scope and shared qualifying years explicitly.
- The original LeBron example remains verified: 25+ playoff PPG in his 20s,
  30s and 40s, including 127 points in five 2025 appearances (25.4 PPG).

The in-page coverage table reconciles player points with game scores from the
same archive. This checks internal integrity, not independent completeness.
**Daily discovery does not download new seasons.** Extending the source cutoff
requires an intentional data refresh and coverage audit.

## Server operation

Root: `/srv/codex-lab/nba-curiosities`, owner `lucaj`, accessed through SSH alias
`cartdotcom-server`. No host ports or new persistent services are needed.

```
raw/box-scores.zip          Original source, approximately 1 GiB
output/snapshot.json        Compact aggregates, approximately 3 MB
output/discoveries.json     2,400 published findings
output/discovery-archive.json  Full cumulative discovery archive
output/published.json       Last acknowledged publication checksum and timestamp
output/job-status.txt       Last completed job
output/last-error.txt       Present after a failed job
output/daily.log            Latest scheduled run's bounded log
backups/latest-publication.tar.gz  Last completed publication's local backup
secrets/publish-token       Purpose-specific publisher credential, mode 0600
```

Cron runs **04:20 UTC / 14:20 Australia/Brisbane daily**. The installer preserves
all other crontab entries. The daily script takes an exclusive lock, mines the
pinned snapshot, validates it, publishes one complete generation and creates a
local backup. A failed stage stops publication; failures are recorded locally.
There is no external notification service. The browser's last-search timestamp
exposes stale publication. Historical discovery eventually exhausts the current
search families; subsequent searches may correctly add zero new findings.

```sh
python3 pipeline/install-cron.py  # Idempotent; only on cartdotcom-server
sh pipeline/run-daily.sh        # Run the exact scheduled workflow now
python3 pipeline/verify.py      # Read-only output integrity check
sh pipeline/rebuild.sh         # Explicit rebuild from the pinned raw archive
```

Compose jobs use pinned images, no network, no host ports, no shared platform
networks and restart policy `no`. Build: 1 CPU / 1,400 MB / 64 PIDs. Discovery:
1 CPU / 512 MB / 64 PIDs, bounded to 30 minutes in the daily script. Publication
uses host Python with a 90-second HTTPS timeout. Rebuild and daily discovery
share the same lock.

To refresh data deliberately, download to a temporary file, validate the ZIP,
preserve the old archive and change the declared cutoff when appropriate.
Rebuild, inspect coverage and publish only after verification. Source or rule
version changes reset the compatible discovery archive.

## Cloudflare publication and privacy

Worker `cartdotcom-nba-curiosities` owns only `/backend/nba` and `/backend/nba/*`.
It forwards the existing session cookie to `/api/auth/session` and fails closed
if authentication cannot be verified. The publication endpoint separately
requires the purpose-specific `NBA_PUBLISH_TOKEN`; the server does not receive
a Cloudflare management API key.

The browser fetches one compact `{snapshot, catalogue}` bundle. KV binding
`NBA_PUBLICATIONS` stores `latest` and `previous` generations. Each generation
occupies one key, so eventual consistency can serve an older complete version
but cannot mix player indices from different snapshots. Uploads require a
SHA-256 checksum, matching source identities and timestamps, validated shapes
and a maximum 16 MiB body. Older publications are rejected. The publisher
verifies the acknowledgement checksum. No raw box scores are uploaded.

An absent or unavailable KV publication falls back to the complete static pair
bundled with the Worker. Reads remain private/no-store. Subsequent browser
filtering uses local memory, without new analysis requests. No new paid plan
was selected. Cloudflare holds only the small publication pairs and web assets;
large inputs and the full discovery archive stay on the local server.

## Local development and deployment

```powershell
npm ci
scp cartdotcom-server:/srv/codex-lab/nba-curiosities/output/snapshot.json public/snapshot.json
scp cartdotcom-server:/srv/codex-lab/nba-curiosities/output/discoveries.json public/discoveries.json
Copy-Item .dev.vars.example .dev.vars
npm run dev
npm test
python -m unittest discover -s pipeline -p 'test_*.py'
npm run check
./deploy.ps1
```

Local URL: `http://127.0.0.1:8795/backend/nba/`. The ignored `.dev.vars` sets
`NBA_LOCAL_DEV=true` only locally. Never deploy that variable. On this host,
`deploy.ps1` temporarily removes the Pages-scoped environment token to use the
existing Wrangler OAuth login, restoring the environment afterward.

Generated data, runtime state, local credentials and backups are ignored by
Git. Worker code and static assets deploy together; the daily pipeline updates
data independently. `deployment-record.json` records the deployment baseline.
The server's `output/published.json` is authoritative for subsequent daily runs.

## Recovery and validation

Local backups are not off-site disaster recovery. A failed job leaves the live
publication available; inspect `daily.log` and `last-error.txt`, correct the
cause and rerun. Restore matching output files from a validated backup before
rebuilding. Avoid replaying older data through the normal publisher: it rejects
older timestamps. An intentional data rollback restores the KV `previous`
generation to `latest` through authenticated Cloudflare management. Worker code
and bundled asset rollback uses `npx wrangler rollback`; it does not roll back KV.

Validation includes 25 Node tests and four Python tests covering aggregation,
age boundaries, missing data, one-game eligibility, same-season intersections,
metric extension, discovery diversity, checksummed publication, stale replay,
authentication and storage outage fallback. Every published finding is also
recomputed against the snapshot. Desktop/mobile browser checks exercise story
browsing, evidence, filters, saved stories and optional manual controls.
Live denial checks verify private access; an authenticated production browser
session was unavailable, so authenticated rendering was checked locally.
