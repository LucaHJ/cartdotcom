from __future__ import annotations

import logging
import json
import time
from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pandas_market_calendars as mcal

from app.artifacts import enforce_retention
from app.broker import PaperAccountDiscovery, PaperBroker
from app.capital import initial_protected_principal
from app.config import settings
from app.database import add_event, connection, fetch_one, migrate, set_setting
from app.notifications import send_capability_reminder, send_gateway_reminder
from app.performance import PERFORMANCE_REFRESH_SECONDS, refresh_strategy_performance
from app.execution import process_next_execution, retry_reports
from app.schedule import scheduled_time


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ibkr-worker")
logging.getLogger("ibapi").setLevel(logging.WARNING)
ET = ZoneInfo("America/New_York")


def initialize_virtual_capital_reserve(snapshot: dict[str, object]) -> None:
    """Fix the protected base-currency principal once, never from a later sale."""
    existing = fetch_one("SELECT value FROM app_settings WHERE key='virtual_cash_reserve_principal'")
    if existing:
        high_water = fetch_one("SELECT value FROM app_settings WHERE key='virtual_cash_reserve_accrued_baseline'")
        accrued_cash = Decimal(str(snapshot["accrued_cash"]))
        if high_water and accrued_cash > Decimal(str(high_water["value"])):
            set_setting("virtual_cash_reserve_accrued_baseline", str(accrued_cash), "interest-accrual-protection")
        return
    total_cash = Decimal(str(snapshot["total_cash"]))
    virtual_capital = Decimal(settings.virtual_investable_capital)
    principal = initial_protected_principal(total_cash, virtual_capital)
    set_setting("virtual_cash_reserve_principal", str(principal), "virtual-capital-initialization")
    set_setting("virtual_cash_reserve_accrued_baseline", str(snapshot["accrued_cash"]), "virtual-capital-initialization")
    set_setting("virtual_cash_reserve_currency", str(snapshot["currency"]), "virtual-capital-initialization")
    set_setting("virtual_investable_capital", str(virtual_capital), "virtual-capital-initialization")


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
        initialize_virtual_capital_reserve(snapshot)
        with connection() as cache_conn:
            cache_conn.execute(
                "INSERT INTO portfolio_cache(singleton,snapshot,captured_at) VALUES(true,%s::jsonb,now()) "
                "ON CONFLICT(singleton) DO UPDATE SET snapshot=excluded.snapshot,captured_at=excluded.captured_at",
                (json.dumps(snapshot, default=str),))
            cache_conn.commit()
        orphaned = [item for item in snapshot["open_orders"] if str(item.get("order_ref", "")).startswith("codex-paper:")]
        if orphaned:
            # Recover working owned orders before the durable queue can submit again.
            for item in orphaned:
                broker.cancel_and_wait(int(item["order_id"]), timeout=30)
        capability_row = fetch_one(
            "SELECT last_capability_probe_at FROM broker_status WHERE singleton=true "
            "AND (live_us_stock_quotes=true OR delayed_us_stock_quotes=true) AND api_us_stock_order_access=true "
            "AND (%s=false OR crypto_usd_order_access=true) "
            "AND last_capability_probe_at > now() - interval '24 hours'"
            ,
            (settings.allow_crypto_paper_trading,),
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
            if settings.allow_crypto_paper_trading:
                try:
                    crypto_probe = broker.probe_crypto_order_access("BTC")
                    capability_update["crypto_usd_order_access"] = bool(crypto_probe["allowed"])
                    capability_update["crypto_order_probe"] = crypto_probe
                except Exception as exc:
                    capability_update["crypto_usd_order_access"] = False
                    capability_update["crypto_order_probe_error"] = str(exc)[:1000]
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
                    "delayed_us_stock_quotes=%s,crypto_usd_order_access=%s,capability_details=%s::jsonb,last_capability_probe_at=now() WHERE singleton=true",
                    (
                        capability_update.get("live_us_stock_quotes"),
                        capability_update.get("api_us_stock_order_access"),
                        capability_update.get("delayed_us_stock_quotes"),
                        capability_update.get("crypto_usd_order_access", False),
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
    log.info("paper execution worker started; research has a separate worker")
    last_health = 0.0
    last_performance = 0.0
    last_retention = 0.0
    last_reports = 0.0
    while True:
        try:
            if time.monotonic() - last_health >= 300:
                if not broker_health():
                    send_gateway_reminder()
                last_health = time.monotonic()
            if time.monotonic() - last_performance >= PERFORMANCE_REFRESH_SECONDS:
                try:
                    refresh_strategy_performance()
                except Exception as exc:
                    log.warning("Strategy performance refresh deferred: %s", exc)
                last_performance = time.monotonic()
            process_next_execution()
            if time.monotonic() - last_reports >= 60:
                retry_reports()
                last_reports = time.monotonic()
            if time.monotonic() - last_retention >= 86400:
                enforce_retention()
                last_retention = time.monotonic()
        except Exception:
            log.exception("Execution worker cycle failed; queued decisions and research remain saved")
        time.sleep(15)


def main() -> None:
    migrate()
    with connection() as conn:
        acquired = conn.execute("SELECT pg_try_advisory_lock(491720260901)").fetchone()
        conn.commit()
        if not acquired or not acquired["pg_try_advisory_lock"]:
            raise RuntimeError("Another IBKR execution worker holds the single-writer lock.")
        conn.execute(
            "UPDATE execution_queue SET status='needs_reconciliation',next_attempt_at=now(),"
            "reason='Execution worker restarted; checking broker state before resuming.' WHERE status='executing'")
        conn.commit()
        try:
            scheduler_loop()
        finally:
            conn.execute("SELECT pg_advisory_unlock(491720260901)")
            conn.commit()


if __name__ == "__main__":
    main()
