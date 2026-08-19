# News Signal Dashboard Audit

Verified: 2026-08-19T08:25:38Z

## Functional scope

`news/api/dashboard-contract-check.js` passed 20 checks against the staging
gateway:

- Dashboard HTML and unauthorized API rejection.
- Status, results, jobs, archived failures, and model experiment history.
- Prediction outcomes, confidence summaries, daily movement, and next-cursor
  pagination.
- Live status, ticker pipeline diagnostics, source statistics, and source
  activity for day, month, and year modes.
- Authenticated WebSocket connection and initial event.
- HTTP 410 for decommissioned simulation routes.
- HTTP 503 `migration_read_only` for mutating calls during shadow operation.

The current dashboard does not call `/api/ticker-signals` or
`/api/market-impacts`; those legacy routes are not cutover requirements.

## Visual scope

Authenticated checks were performed at 1440x900 and 390x844 in dark mode.
Prediction Accuracy, Overview, Sources, settings, both SVG chart types, sticky
outcome headers, theme switching, and infinite outcome loading were exercised.
There were no browser console errors, visible error panels, or page-level
horizontal overflow. Infinite loading increased the rendered prediction rows
from 50 to 100.

The audit found heatmap button text exceeding its content box by 6-11 pixels on
mobile. Heatmap data columns were increased from 132 to 160 pixels. The repeated
overflow check then returned zero affected cells on desktop and mobile.

## Performance sample

The slowest staging reads during the final check were:

- `/api/predictions/daily`: approximately 2.26 seconds.
- `/api/results?limit=20`: approximately 1.64 seconds.
- `/api/predictions/summary`: approximately 0.65 seconds.

These are acceptable for staging but should be monitored after fresh production
data is imported and concurrent local ingestion begins.

## Offline snapshot verification

The Cloudflare outage gateway was tested with a complete 1.27 MB snapshot from
the local PostgreSQL API and an intentionally unreachable live origin.

- The dated offline banner appeared and all widgets loaded without visible
  errors or console warnings.
- Prediction accuracy tables and the daily movement graph rendered from stored
  data; filtering, sorting, heatmap selection, and infinite loading were
  disabled.
- Overview retained 20 event summaries. Sources retained 81 source rows, 27
  ticker-pipeline rows, and its acquisition chart. Settings retained 12 recent
  jobs, 500 archived failures, and 20 article-impact rows.
- Desktop and 390x844 mobile layouts had no document-level horizontal overflow
  or visible skeleton loaders after completion.
- With the same browser page left open, changing the test gateway from a dead
  origin to a live origin cleared snapshot mode on the next 30-second probe,
  reloaded current data, and re-enabled all live controls automatically.
