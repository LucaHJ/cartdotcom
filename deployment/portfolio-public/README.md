# Public portfolio projections

These views publish live production records, not fixtures. The investment system
is paper trading. The public surface is deliberately a projection, not an admin
dashboard with hidden buttons.

`export.py` runs once per minute through the existing server user's crontab. Fixed, bounded SQL runs
inside read-only transactions with statement timeouts. Only explicit columns
are selected. No caller input reaches SQL. Each complete JSON file replaces the
previous version atomically; a failure retains the last known good version.

Public fields:
- Investment: recent run timestamps/status, decision symbols/actions/target
  percentages/validation states, execution symbols/sides/prices/timestamps.
- Market: recent article titles, source labels/URLs/timestamps, and a separate
  recent priced cohort with baselines and allowlisted horizon observations.
- Research: completed resources' names/kinds/derived summaries/usefulness,
  canonical resource/source links and creation timestamps.

Never publish account identifiers, balances, raw broker responses, prompt or
report text, credentials, sender IDs, DMs, personal instructions, private notes,
storage paths, or admin controls. URL query strings/fragments are stripped.
Changing these allowlists requires a deliberate privacy review.

The origin is an unprivileged process without Docker/database access, bound to
the private Docker bridge address on port 3112. A dedicated VPC service points
only to this origin, with no access to dashboard routes. The public Worker accepts only GET/HEAD for three
fixed paths, forwards no visitor credentials, and caches for 30 seconds. Do not
add a general proxy, authenticated dashboard redirect or public write route.

Deployment: install these files under `/srv/cartdotcom/portfolio-public`, create
`data` owned by lucaj, start the dedicated compose project, and add a user cron
entry calling `export.py` once per minute with `flock` (no overlapping exports).
The exporter runs as the existing Docker-capable user. The origin container has
only read-only snapshot and source mounts, no Docker socket and no DB access.
Run `install-cron.py` to preserve other jobs while installing the exporter.
Do not change production platform Caddy or compose; this is a separate service.
Deploy `worker.js` as `cartdotcom-portfolio-public` using `wrangler.jsonc`, whose
dedicated VPC service points to 172.19.0.1:3112 through the existing tunnel.
Compatibility date: 2026-09-26. Observability is enabled.
Frontend: `public-{investment,market,research}.html`, refresh interval 60 seconds,
stale warning after five minutes. These are bounded recent windows, not corpus
totals. Rollback: remove the exporter cron entry, stop the dedicated compose
origin, and remove its Worker/VPC service. Existing authenticated applications
are unchanged.
