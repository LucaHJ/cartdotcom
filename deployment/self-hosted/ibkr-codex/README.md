# IBKR Codex Paper Trader

Paper-only autonomous portfolio research and execution for `cartdotcom-server`. The runtime is hard-locked to IB Gateway paper port `4002` and an allowlisted account identifier beginning with `DU`. There is no live-account mode.

The independent research worker makes one daily US-calendar checkpoint. On a regular, non-holiday NYSE day it starts at the session midpoint (12:45 PM America/New_York on regular days), using saved holdings, up to 90 daily strategy marks and 200 confirmed trades independently of IBKR. The `event-driven-v2` protocol runs nine sequential, isolated `gpt-5.6-sol` / `xhigh` stages within a three-hour total deadline. Weekends, US federal holidays, NYSE holidays and special closures still receive a portfolio-summary email without launching research. HOLD is valid; every existing holding must appear in the full allocation plan.

The six screens cover 36 industries: compute/semiconductors/data centres/quantum/cybersecurity; nuclear/power/grid/storage/LNG; gene editing/cell therapy/biotech/healthcare; European and US defence/aerospace/drones/minerals/automation; metals/water/agriculture/renewables/logistics/construction; software/financials/insurance/consumer/real estate. Each industry requires past/present/future events, two source domains, dated price evidence, transmission to earnings, bottlenecks, bear cases and invalidation. Synthesis compares at least 12 instruments across eight industries and ten causal links; a separate skeptical review challenges at least eight claims and three portfolio alternatives; final allocation must respond to the review. These structural checks enforce breadth, not the truth of a source or guaranteed investment success.

Completed stages are atomically checkpointed in the existing compressed runner file. A restart resumes validated stages without resetting the total deadline. Each stage has at most two attempts. An incomplete/invalid pipeline fails closed with no new queue. Exact stage prompts/results, transcripts, usage and runtimes are retained; the dashboard exposes stage progress and expandable records, and emails summarize industry findings and the chosen plan. Interrupted usage is labelled incomplete where final token totals were unavailable. Runtime is earned by substantive work, not artificial waiting. A late completion may safely defer orders to the next market session.

### Diagnostic recovery (September 26 update)

Industry screens now receive current portfolio context and optional headline-only news, not the entire raw feed, historical archive or earlier screens. Synthesis receives explicitly sampled history and source-linked sector digests. Review/allocation retain the candidate comparisons and objections instead of duplicating every full screen. Full original inputs and outputs remain archived; clipping is disclosed and never silently removes current holdings or capital restrictions.

The runner concurrently drains process I/O, checkpoints live progress/diagnostics every 30 seconds, and retains a redacted stderr tail, exit code, event count, last progress and error category even on timeout. Five minutes without initial research activity, ten minutes without subsequent activity, and the existing stage/three-hour ceilings are separate failure categories. Missing final token accounting is marked incomplete. Authentication/quota failures stop without repetitive retries. Other transient failures receive a lean retry; after two failed attempts an independent screen is deferred while other screens continue, then receives at most one final recovery attempt. All six screens must validate before synthesis or allocation can run.

`POST /api/control/recover/{failed_run_id}` uses the existing dashboard authentication. It idempotently creates a NEW run linked to the failed source; the original record and archive remain untouched. Only validated industry screens from a compatible failed run no older than 72 hours can be reused. Reused evidence retains its original date and source usage (not double-counted in the new run). Portfolio context, synthesis, challenge and allocation are refreshed; later stages must verify dated evidence. No old decisions/orders are restored. The new explicitly requested run has its own three-hour budget. Manual recovery may research on weekends, but never changes market-hour execution restrictions or queue expiry.

Dashboard performance is calculated by an independent scheduler at each UTC wall-clock hour; capture starts at `HH:00` and the compressed file normally completes a few seconds later. Broker health checks and order monitoring cannot delay this scheduler. A restart fills the current hour only when that hour has no archive yet. Performance remains limited to the protected 20,000-base-currency strategy sleeve: strategy cash above the protected principal plus the market value of held USD securities converted to the account base currency. Each hourly record contains the portfolio totals and every holding's quantity, price, cost, value, gain/loss, return, daily movement and weight. PostgreSQL keeps one idempotent row per UTC hour and the server writes one compressed, UTC-timestamped JSON file per hour (`YYYY-MM-DDTHH-00-00Z.json.gz`). The dashboard lazily expands these beneath UTC year/month/day/hour headings and derives exact one-hour, 24-hour and all-time portfolio, invested-value and holding returns from archived points and cost basis. Uncompressed records are hard-limited to 174,762 bytes/hour (about 170.7 KiB including record metadata) and 4,194,304 bytes/day; even the hard daily ceiling projects below 1.5 GiB/year, and the dashboard reports the measured projection against a 5 GiB/year limit. Public daily prices are independently refreshed and labelled for reporting only; missing or more-than-seven-day-old data makes the total explicitly incomplete. These prices never enter order creation, sizing, or fill validation, which remain IBKR-only. Raw full-account balances stay in private broker safety/audit storage and are omitted from research context and dashboard performance APIs.

A separate execution worker consumes the durable PostgreSQL queue. It refreshes the portfolio, AUD/USD conversion, quotes, cash protection and risk checks only at execution. Connection or data failures defer execution without failing research or changing the kill switch. Closed-session queues sleep until the next official NYSE open. Signals remain queued across closed sessions, weekends and holidays, then expire five minutes before the next scheduled research session; newer completed research supersedes unsubmitted older signals. Changed or previously unknown holdings trigger fresh research before trading. Only monitored whole-share DAY limit orders on the allowlisted paper account are allowed.

Every research and execution email starts with the persisted order-fill status. A terminal unfilled or partially filled result sends a dedicated warning; if those decisions are later restored and filled, a separate follow-up confirms recovery.

Runner results are compressed and persisted before HTTP delivery. Retrying the same run uses its saved prompt and result. Research and execution reports are separate, so an email never implies queued orders have already filled.

## Safety defaults

- Startup: kill switch engaged and trading disabled.
- Assets: long-only USD-listed stocks and ordinary ETFs; crypto remains prohibited.
- Sizing uses the virtual 20,000 account-base-currency budget, not the full broker balance. The 980,000 principal plus protected interest remains unavailable.
- Allocation caps and cash target are agent-selected per run; null means uncapped. This includes individual/new holdings, industries and gross turnover.
- Position targets plus cash must sum to 100%; industry totals must equal their constituent positions. All percentages must be finite. No fixed equity goal or required industry sleeve.
- The agent cannot alter protected capital, account identity, paper-only execution, permitted instruments, quote quality, order monitoring or the kill switch.
- BUY sizing keeps a USD5 plus USD0.01/share fee cushion in addition to its worst permitted reprice; this is an execution allowance, not a fixed equity-allocation goal.
- Historical queues without an adaptive plan retain their original 20% turnover / 5% strategy-cash limits.
- At most 10 BUY/SELL decisions per run (HOLD decisions do not consume the limit); no shares below $5; live or explicitly authorized delayed stock quotes and a spread at or below 1% required.
- At most 3 monitored limit-order attempts with a maximum 0.75% slippage envelope; remaining quantity is cancelled.
- The dashboard kill switch pauses execution, not research. Startup reconciles uncertain submissions using broker order references and permanent identifiers; unknown submissions are never blindly replayed.

## Adaptive allocations and independent FX data

The former 55/25/15/5 sleeves are retired. Research actively compares non-US exposure and industry-specific opportunities, but can select any justified distribution, including cash or concentrated investments. Each decision names a safe industry identifier matching its saved allocation plan. The plan covers existing holdings, zero-weight exits and new additions; caps may be null. Uncapped concentration increases risk and is not a performance guarantee.

The deterministic executor reads the immutable plan, processes sells before buys, and sizes each trade from fresh strategy-only capital, confirmed holdings, available cash and selected caps. It does not let an agent enlarge the original AUD20,000 allocation with protected cash. Strategy gains/losses change the current deployable value; losses are not topped up.

Research separates documented events from scheduled catalysts and uncertain forecasts, investigates what is priced in, and checks overlapping ETF/company exposures. A dip or exciting technology alone is not a BUY signal. Performance comparisons use consistent observation windows and distinguish currency effects, cash drag, fees and unfilled orders from selection. Daily Yahoo bars use the regular-market quote timestamp when available so the opening timestamp is not mistaken for the time of the latest price.

IBKR is the preferred AUD/USD pricing source. When its FX feed is unavailable, the executor fetches official daily ECB reference data directly from the ECB Data API and calculates the AUD/USD cross from matching EUR-based observations. It rejects invalid, future-dated or over-four-calendar-day-old data and applies a 2% conservative haircut to available USD capital. This is daily reference data, not an intraday quote. A validated local cache refreshes every six hours; network failures may use it only within the same maximum observation age. The source, reference date, rate, retrieval time, response hash and haircut are recorded with execution snapshots. Stock bid/ask prices still require the existing IBKR live/authorized-delayed quote checks; the fallback does not bypass account connectivity, cash protection or order reconciliation.

## Deployment state

The web route is `/backend/ibkr_codex`. Regular dashboard access reuses the News Signal bearer token. Temporary email links grant access only to the IB Gateway validation console and expire after two hours. Raw artifacts are retained indefinitely unless the measured annual projection exceeds 10 GiB, after which raw artifacts older than one year are pruned while database metadata remains.

The production stack lives at `/srv/codex-lab/ibkr-codex/source` on `cartdotcom-server`. PostgreSQL and compressed run artifacts remain local. A verified database backup runs daily at 03:20 UTC from the server user's crontab and keeps 14 daily dumps in `/srv/backups/ibkr-codex`.

## First connection / return checklist

1. Open the latest “IBKR paper account authentication required” email and follow its two-hour validation link.
2. In the gateway console, confirm **Paper Trading**, then log in and complete IBKR 2FA. Never enter live-account credentials into this gateway.
3. Leave the gateway open. Within five minutes the worker discovers exactly one exposed `DU…` account and permanently allowlists it. Zero or multiple accounts fail closed.
4. The worker reads the portfolio and balance, tests live US-stock data, and sends a non-executing one-share SPY **What-If** order. Both checks must pass before the one-time automatic paper-trading arm is allowed.
5. Open the dashboard at `https://cartdotcom-news-signal-container.lucajeannin.workers.dev/backend/ibkr_codex` using the existing News Signal login. Confirm the three IB Gateway capabilities show readable / available / allowed. The funded paper balance and holdings then appear under “Portfolio captured for the latest decision” after the first run.

If API order access is blocked, disable IB Gateway's read-only API setting while remaining in Paper Trading. If live quotes are blocked, enable the necessary US stock market-data entitlement in IBKR; execution will remain locked and an hourly email will continue until both checks pass. The initial automatic arm happens only once. Any later dashboard kill-switch action is durable and cannot be undone by the health worker.

## Operations

```sh
cd /srv/codex-lab/ibkr-codex/source
docker compose ps
docker compose logs --tail=100 worker
docker compose logs --tail=100 research-worker
docker compose logs --tail=100 codex-runner
docker compose --profile tools run --rm backup
```

The Python IBKR SDK is pinned to the official 10.50.1 distribution and SHA-256 verified by `scripts/install_ibapi.py`; the obsolete PyPI 9.81 client cannot request fractional-size-aware FX quotes. For local setup, run that installer before installing this project. Integration tests use a disposable database named `ibkr_queue_test_*`, an isolated temporary `ARTIFACT_ROOT`, and fake every broker/runner interaction: `PGDATABASE=ibkr_queue_test_<suffix> ARTIFACT_ROOT=/tmp/ibkr-queue-test-artifacts python tests/test_queue_integration.py`. Tests fail closed if a disposable database is ever paired with the production `/data/artifacts` mount.

The SDK/Gateway protocol-223 combination uses the verified legacy wire format only for account-summary cancellation; protobuf cancellation left subscriptions active and caused IBKR error 322 on the third refresh. Other messages, including order submission, retain the SDK's protocol selection. Summary callbacks are matched to the active request, every exit cancels the subscription, and broker rejections are reported immediately. `scripts/verify_account_refresh.py` checks six consecutive read-only snapshots with dedicated client id 43 and order submission disabled.

The worker health-checks IBKR every five minutes and emails at most once per hour while login or capability intervention is required. A separate research-worker continues scheduling during broker outages. Execution retries are checked every minute; interrupted submissions are reconciled before any further trading. Owned working orders carry a `codex-paper:` prefix and cancellation must be confirmed. Live US quotes are preferred; delayed 10-15 minute US quotes are accepted only when `ALLOW_DELAYED_MARKET_DATA=true` is explicitly configured, and are shown as delayed in the dashboard and run artifacts.
