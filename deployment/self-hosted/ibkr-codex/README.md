# IBKR Codex Paper Trader

Paper-only autonomous portfolio research and execution for `cartdotcom-server`. The runtime is hard-locked to IB Gateway paper port `4002` and an allowlisted account identifier beginning with `DU`. There is no live-account mode.

The independent research worker runs at the actual midpoint of each official NYSE session (12:45 PM America/New_York on regular days and earlier on shortened sessions). It uses the last saved portfolio with a visible capture time (or explicitly unknown holdings), launches isolated `gpt-5.6-sol` research at `xhigh` effort with a two-hour deadline, and saves research and target-weight decisions without connecting to IBKR. HOLD, including an empty decision list, is valid.

A separate execution worker consumes the durable PostgreSQL queue. It refreshes the portfolio, AUD/USD conversion, quotes, cash protection and risk checks only at execution. Connection or data failures defer execution without failing research or changing the kill switch. Signals expire at the current NYSE close (or next session close for after-hours research); newer completed research supersedes unsubmitted older signals. Changed or previously unknown holdings trigger fresh research before trading. Only monitored whole-share DAY limit orders on the allowlisted paper account are allowed.

Runner results are compressed and persisted before HTTP delivery. Retrying the same run uses its saved prompt and result. Research and execution reports are separate, so an email never implies queued orders have already filled.

## Safety defaults

- Startup: kill switch engaged and trading disabled.
- Assets: long-only USD-listed stocks and ordinary ETFs; crypto remains prohibited.
- Sizing uses the virtual 20,000 account-base-currency budget, not the full broker balance. The 980,000 principal plus protected interest remains unavailable.
- New position: at most 5% of net liquidation value.
- Total position: at most 15%.
- Per-run turnover: at most 20%.
- Cash reserve: at least 5%.
- At most 10 BUY/SELL decisions per run (HOLD decisions do not consume the limit); no shares below $5; live or explicitly authorized delayed stock quotes and a spread at or below 1% required.
- At most 3 monitored limit-order attempts with a maximum 0.75% slippage envelope; remaining quantity is cancelled.
- The dashboard kill switch pauses execution, not research. Startup reconciles uncertain submissions using broker order references and permanent identifiers; unknown submissions are never blindly replayed.

## Standing allocation targets and independent FX data

Every future research prompt targets 25% international equities, 15% power/grid infrastructure, 55% other diversified US equities, and at least 5% cash. International holdings use liquid US-listed, USD-traded unleveraged ETFs with predominantly non-US underlying exposure; foreign listings and FX trades remain prohibited. Each decision records a mutually exclusive allocation bucket. The agent must assess current/proposed sleeve weights, gaps and overlap, investigate power demand from data centres/mining, and explain any shortfall. These are strategic research targets, not forced trades or exceptions to existing risk limits; changes may be staged and HOLD remains valid.

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

The Python IBKR SDK is pinned to the official 10.50.1 distribution and SHA-256 verified by `scripts/install_ibapi.py`; the obsolete PyPI 9.81 client cannot request fractional-size-aware FX quotes. For local setup, run that installer before installing this project. Integration tests use a disposable database named `ibkr_queue_test_*` and fake every broker/runner interaction: `PGDATABASE=ibkr_queue_test_<suffix> python tests/test_queue_integration.py`.

The SDK/Gateway protocol-223 combination uses the verified legacy wire format only for account-summary cancellation; protobuf cancellation left subscriptions active and caused IBKR error 322 on the third refresh. Other messages, including order submission, retain the SDK's protocol selection. Summary callbacks are matched to the active request, every exit cancels the subscription, and broker rejections are reported immediately. `scripts/verify_account_refresh.py` checks six consecutive read-only snapshots with dedicated client id 43 and order submission disabled.

The worker health-checks IBKR every five minutes and emails at most once per hour while login or capability intervention is required. A separate research-worker continues scheduling during broker outages. Execution retries are checked every minute; interrupted submissions are reconciled before any further trading. Owned working orders carry a `codex-paper:` prefix and cancellation must be confirmed. Live US quotes are preferred; delayed 10-15 minute US quotes are accepted only when `ALLOW_DELAYED_MARKET_DATA=true` is explicitly configured, and are shown as delayed in the dashboard and run artifacts.
