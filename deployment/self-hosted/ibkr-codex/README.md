# IBKR Codex Paper Trader

Paper-only autonomous portfolio research and execution for `cartdotcom-server`. The runtime is hard-locked to IB Gateway paper port `4002` and an allowlisted account identifier beginning with `DU`. There is no live-account mode.

The scheduled worker runs at the actual midpoint of each official NYSE session (12:45 PM America/New_York on regular days and earlier on shortened sessions). It snapshots the portfolio, launches an isolated `gpt-5.6-sol` Codex research process at `xhigh` effort with a two-hour deadline, records all artifacts, validates any proposed trades against deterministic risk limits, and only then submits monitored whole-share DAY limit orders. HOLD is a first-class valid outcome.

## Safety defaults

- Startup: kill switch engaged and trading disabled.
- Assets: long-only USD-listed stocks and ordinary ETFs.
- New position: at most 5% of net liquidation value.
- Total position: at most 15%.
- Per-run turnover: at most 20%.
- Cash reserve: at least 5%.
- At most 5 orders per run; no shares below $5; live quotes and a spread at or below 1% required.
- At most 3 monitored limit-order attempts with a maximum 0.75% slippage envelope; remaining quantity is cancelled.
- Any error or interrupted run engages the kill switch. Startup recovery cancels owned orphaned paper orders.

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
docker compose logs --tail=100 codex-runner
docker compose --profile tools run --rm backup
```

The worker health-checks IBKR every five minutes and emails at most once per hour while login or capability intervention is required. It also recovers interrupted research runs fail-closed, engages the kill switch, and cancels any working order carrying this application's `codex-paper:` ownership prefix. Live US quotes are preferred; delayed 10-15 minute US quotes are accepted only when `ALLOW_DELAYED_MARKET_DATA=true` is explicitly configured, and are shown as delayed in the dashboard and run artifacts.
