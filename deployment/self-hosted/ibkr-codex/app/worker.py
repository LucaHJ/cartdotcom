from __future__ import annotations

import logging
import json
import time
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pandas_market_calendars as mcal

from app.artifacts import enforce_retention
from app.broker import PaperAccountDiscovery, PaperBroker
from app.config import settings
from app.database import add_event, connection, fetch_one, migrate, set_setting
from app.notifications import send_capability_reminder, send_gateway_reminder
from app.workflow import execute_run, queue_run


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ibkr-worker")
ET = ZoneInfo("America/New_York")


def scheduled_time(now: datetime) -> datetime | None:
    local = now.astimezone(ET)
    schedule = mcal.get_calendar("NYSE").schedule(start_date=local.date(), end_date=local.date())
    if schedule.empty:
        return None
    market_open = schedule.iloc[0]["market_open"].to_pydatetime()
    market_close = schedule.iloc[0]["market_close"].to_pydatetime()
    return market_open + (market_close - market_open) / 2


def broker_health() -> bool:
    broker: PaperBroker | None = None
    discovery: PaperAccountDiscovery | None = None
    try:
        configured = settings.ibkr_paper_account
        if not configured:
            row = fetch_one("SELECT value FROM app_settings WHERE key='paper_account_id'")
            configured = str(row["value"]) if row and row.get("value") else ""
        adopted = False
        if not configured:
            discovery = PaperAccountDiscovery()
            configured = discovery.discover(timeout=10)[0]
            discovery.close()
            discovery = None
            set_setting("paper_account_id", configured, "automatic-paper-discovery")
            adopted = True
        broker = PaperBroker(configured)
        broker.connect_paper(timeout=10)
        snapshot = broker.portfolio_snapshot()
        orphaned = [item for item in snapshot["open_orders"] if str(item.get("order_ref", "")).startswith("codex-paper:")]
        if orphaned:
            set_setting("kill_switch", True, "worker-recovery")
            set_setting("trading_enabled", False, "worker-recovery")
            for item in orphaned:
                broker.cancel_and_wait(int(item["order_id"]), timeout=30)
        capability_row = fetch_one(
            "SELECT last_capability_probe_at FROM broker_status WHERE singleton=true "
            "AND (live_us_stock_quotes=true OR delayed_us_stock_quotes=true) AND api_us_stock_order_access=true "
            "AND last_capability_probe_at > now() - interval '24 hours'"
        )
        capability_update: dict[str, object] | None = None
        if not capability_row:
            capability_update = {"portfolio_readable": True}
            try:
                contract = broker.resolve_stock("SPY")
                quote = broker.quote(contract)
                capability_update["live_us_stock_quotes"] = quote.market_data_type == 1
                capability_update["delayed_us_stock_quotes"] = quote.is_delayed
                capability_update["quote"] = {
                    "symbol": quote.symbol,
                    "market_data_type": quote.market_data_type,
                    "source": quote.source_label,
                    "bid_available": quote.bid > 0,
                    "ask_available": quote.ask > 0,
                    "last_available": quote.last > 0,
                }
            except Exception as exc:
                capability_update["live_us_stock_quotes"] = False
                capability_update["delayed_us_stock_quotes"] = False
                capability_update["quote_error"] = str(exc)[:1000]
            try:
                order_probe = broker.probe_us_stock_order_access("SPY")
                capability_update["api_us_stock_order_access"] = bool(order_probe["allowed"])
                capability_update["order_probe"] = order_probe
            except Exception as exc:
                capability_update["api_us_stock_order_access"] = False
                capability_update["order_probe_error"] = str(exc)[:1000]
        with connection() as conn:
            conn.execute(
                "UPDATE broker_status SET state='connected',account_id=%s,message=%s,portfolio_readable=true,"
                "last_connected_at=now(),last_checked_at=now(),validation_required_since=NULL WHERE singleton=true",
                (
                    snapshot["account_id"],
                    f"Paper API connected; recovered {len(orphaned)} orphaned orders."
                    if orphaned else
                    "Paper API connected; the sole DU account was automatically allowlisted."
                    if adopted else
                    "Paper API connected",
                ),
            )
            if capability_update is not None:
                conn.execute(
                    "UPDATE broker_status SET live_us_stock_quotes=%s,api_us_stock_order_access=%s,"
                    "delayed_us_stock_quotes=%s,capability_details=%s::jsonb,last_capability_probe_at=now() WHERE singleton=true",
                    (
                        capability_update.get("live_us_stock_quotes"),
                        capability_update.get("api_us_stock_order_access"),
                        capability_update.get("delayed_us_stock_quotes"),
                        json.dumps(capability_update, default=str),
                    ),
                )
            conn.commit()
        if capability_update is not None:
            execution_capable = bool(
                (capability_update.get("live_us_stock_quotes") or capability_update.get("delayed_us_stock_quotes"))
                and capability_update.get("api_us_stock_order_access")
            )
        else:
            capabilities = fetch_one(
                "SELECT live_us_stock_quotes,delayed_us_stock_quotes,api_us_stock_order_access FROM broker_status WHERE singleton=true"
            )
            execution_capable = bool(
                capabilities
                and (capabilities["live_us_stock_quotes"] or capabilities["delayed_us_stock_quotes"])
                and capabilities["api_us_stock_order_access"]
            )
        armed = fetch_one("SELECT value FROM app_settings WHERE key='initial_auto_arm_completed'")
        if not armed and execution_capable:
            # The user explicitly selected automatic paper execution. Arm only
            # once after a complete DU-account snapshot; a later kill-switch
            # action is therefore durable and can never be undone by health checks.
            set_setting("trading_enabled", True, "automatic-paper-initialization")
            set_setting("kill_switch", False, "automatic-paper-initialization")
            set_setting("initial_auto_arm_completed", True, "automatic-paper-initialization")
        elif not armed:
            send_capability_reminder(
                "Live or owner-authorized delayed US-stock quotes and a non-executing US-stock What-If order must both pass before automatic paper trading is armed."
            )
        return True
    except Exception as exc:
        with connection() as conn:
            conn.execute(
                "UPDATE broker_status SET state='needs_auth',message=%s,portfolio_readable=false,last_checked_at=now(),"
                "validation_required_since=COALESCE(validation_required_since,now()) WHERE singleton=true",
                (str(exc)[:2000],),
            )
            conn.commit()
        return False
    finally:
        if broker is not None:
            broker.disconnect_paper()
        if discovery is not None:
            discovery.close()


def scheduler_loop() -> None:
    log.info("paper-only scheduler started")
    last_health = 0.0
    last_retention = 0.0
    broker_ready = False
    while True:
        now = datetime.now(UTC)
        if time.monotonic() - last_health >= 300:
            broker_ready = broker_health()
            if not broker_ready:
                send_gateway_reminder()
            last_health = time.monotonic()
        due = scheduled_time(now)
        if due and broker_ready and 0 <= (now - due).total_seconds() < 300:
            existing = fetch_one(
                "SELECT id,status FROM research_runs WHERE trigger='schedule' "
                "AND (scheduled_for AT TIME ZONE 'America/New_York')::date=(%s AT TIME ZONE 'America/New_York')::date",
                (due,),
            )
            if not existing:
                run_id = queue_run(due, "schedule")
                log.info("queued scheduled run %s", run_id)
        queued = fetch_one("SELECT id FROM research_runs WHERE status='queued' ORDER BY created_at LIMIT 1")
        if queued:
            try:
                execute_run(str(queued["id"]))
            except Exception:
                log.exception("run %s failed closed", queued["id"])
        if time.monotonic() - last_retention >= 86400:
            removed = enforce_retention()
            log.info("retention check removed %d expired artifacts", removed)
            last_retention = time.monotonic()
        time.sleep(15)


def main() -> None:
    migrate()
    stale = []
    with connection() as conn:
        stale = list(conn.execute(
            "SELECT id FROM research_runs WHERE status IN ('snapshotting','researching','validating','executing','reconciling')"
        ).fetchall())
        if stale:
            conn.execute(
                "UPDATE research_runs SET status='failed',finished_at=now(),error='Worker restarted during an incomplete run; fail-closed recovery engaged.' "
                "WHERE status IN ('snapshotting','researching','validating','executing','reconciling')"
            )
            conn.execute("UPDATE app_settings SET value='true'::jsonb,updated_at=now() WHERE key='kill_switch'")
            conn.execute("UPDATE app_settings SET value='false'::jsonb,updated_at=now() WHERE key='trading_enabled'")
            conn.commit()
    for row in stale:
        add_event(str(row["id"]), "run.recovered", "Worker restart detected; run failed closed and any owned order will be cancelled.")
    with connection() as conn:
        acquired = conn.execute("SELECT pg_try_advisory_lock(491720260901)").fetchone()
        if not acquired or not acquired["pg_try_advisory_lock"]:
            raise RuntimeError("Another IBKR scheduler holds the single-writer lock.")
        conn.commit()
        try:
            # PostgreSQL advisory locks belong to a database session, so the
            # scheduler must retain this pooled connection for its full life.
            scheduler_loop()
        finally:
            conn.execute("SELECT pg_advisory_unlock(491720260901)")
            conn.commit()


if __name__ == "__main__":
    main()
