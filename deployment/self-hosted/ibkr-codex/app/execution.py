"""Durable paper execution, independently retried after research has completed."""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from app.broker import PaperBroker, TERMINAL_ORDER_STATES
from app.database import add_event, connection, fetch_all, fetch_one, setting_bool
from app.notifications import send_run_report
from app.policy import PolicyViolation
from app.schedule import execution_window_sufficient
from app.workflow import _enrich_positions, _execute_decision, _store_snapshot, _virtual_capital_context, queue_run

log = logging.getLogger(__name__)
FINAL_DECISIONS = {"accepted_no_order", "executed", "partially_filled", "unfilled", "rejected"}


def holdings_signature(snapshot: dict[str, Any]) -> list[tuple[str, str, str, Decimal]]:
    return sorted((str(p.get("conid", p.get("symbol"))), str(p.get("sec_type")), str(p.get("currency")),
                   Decimal(str(p["quantity"]))) for p in snapshot.get("positions", [])
                  if Decimal(str(p["quantity"])) != 0)


def holdings_match_fills(context: dict[str, Any], snapshot: dict[str, Any], orders: list[dict[str, Any]]) -> bool:
    """Only our confirmed fills may change holdings between research and execution."""
    def quantities(value):
        result = {}
        for item in value.get("positions", []):
            key = (item["symbol"], item["sec_type"], item["currency"])
            result[key] = result.get(key, Decimal("0")) + Decimal(str(item["quantity"]))
        return result
    expected = quantities(context)
    for order in orders:
        key = (order["symbol"], "STK", "USD")
        signed = Decimal(str(order["filled_quantity"])) * (1 if order["side"] == "BUY" else -1)
        expected[key] = expected.get(key, Decimal("0")) + signed
    actual = quantities(snapshot)
    return {k: v for k, v in expected.items() if v} == {k: v for k, v in actual.items() if v}


def set_queue_status(run_id: str, status: str, reason: str, terminal: bool = False) -> None:
    with connection() as conn:
        previous = conn.execute("SELECT status,reason FROM execution_queue WHERE run_id=%s", (run_id,)).fetchone()
        conn.execute(
            "UPDATE execution_queue SET status=%s,reason=%s,next_attempt_at=now()+interval '60 seconds',"
            "finished_at=CASE WHEN %s THEN now() ELSE NULL END WHERE run_id=%s", (status, reason[:4000], terminal, run_id))
        conn.commit()
    if not previous or previous["status"] != status or previous["reason"] != reason[:4000]:
        add_event(run_id, f"execution.{status}", reason[:4000])


def save_executions(broker: PaperBroker, run_id: str) -> list[dict[str, Any]]:
    executions = broker.executions()
    orders = fetch_all("SELECT * FROM orders WHERE run_id=%s", (run_id,))
    with connection() as conn:
        for item in executions:
            row = next((o for o in orders if item.get("order_ref") == o["order_ref"] or
                        (o["broker_perm_id"] and item.get("perm_id") == o["broker_perm_id"])), None)
            if not row:
                continue
            conn.execute(
                "INSERT INTO executions(exec_id,order_id,account_id,symbol,side,shares,price,executed_at,raw) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s,now(),%s::jsonb) ON CONFLICT(exec_id) DO NOTHING",
                (item["exec_id"], row["id"], item["account"], item["symbol"], item["side"],
                 item["shares"], item["price"], json.dumps(item, default=str)))
        conn.commit()
    return executions


def reconcile_orders(broker: PaperBroker, run_id: str, snapshot: dict[str, Any]) -> bool:
    unresolved = fetch_all("SELECT * FROM orders WHERE run_id=%s AND NOT terminal ORDER BY created_at", (run_id,))
    if not unresolved:
        return True
    completed = broker.completed_orders()
    executions = save_executions(broker, run_id)
    for row in unresolved:
        working = next((o for o in snapshot["open_orders"] if o["order_ref"] == row["order_ref"]), None)
        if working:
            # A cancellation must be confirmed; a disconnected cancel is never treated as success.
            state = broker.cancel_and_wait(int(working["order_id"]))
            status, filled, average, perm_id = state.status, state.filled, state.avg_fill_price, state.perm_id
            broker_id = working["order_id"]
        else:
            done = next((o for o in completed if o["order_ref"] == row["order_ref"]), None)
            if not done or done["status"] not in TERMINAL_ORDER_STATES:
                return False
            fills = [e for e in executions if e.get("order_ref") == row["order_ref"]]
            total = sum((Decimal(str(e["shares"])) for e in fills), Decimal("0"))
            reported = Decimal(str(done["filled"]))
            if not reported.is_finite() or reported > Decimal("1e20"):
                reported = total
            filled = max(total, reported)
            if filled > 0 and total != filled:
                return False  # Missing fill prices: do not guess cash usage or replay the order.
            average = sum((Decimal(str(e["shares"])) * Decimal(str(e["price"])) for e in fills), Decimal("0")) / filled if filled else Decimal("0")
            status, perm_id, broker_id = done["status"], done["perm_id"], done["order_id"]
        with connection() as conn:
            conn.execute(
                "UPDATE orders SET broker_order_id=%s,broker_perm_id=%s,status=%s,filled_quantity=%s,"
                "remaining_quantity=GREATEST(0,requested_quantity-%s),average_fill_price=%s,terminal=true,"
                "finished_at=now() WHERE id=%s", (broker_id, perm_id, status, filled, filled, average, row["id"]))
            conn.commit()
        add_event(run_id, "order.reconciled", f"{row['symbol']}: {status}; confirmed fill {filled}.")
    save_executions(broker, run_id)
    return True


def _request_fresh_research(run_id: str, reason: str) -> None:
    set_queue_status(run_id, "superseded", reason, True)
    if not fetch_one("SELECT id FROM research_runs WHERE status IN ('queued','snapshotting','researching','validating') LIMIT 1"):
        queue_run(datetime.now(UTC), "portfolio_refresh")


def process_queue_entry(entry: dict[str, Any]) -> None:
    run_id = str(entry["run_id"])
    broker = None
    try:
        uncertain = fetch_one("SELECT id FROM orders WHERE run_id=%s AND NOT terminal LIMIT 1", (run_id,))
        if not uncertain:
            if entry["expires_at"] <= datetime.now(UTC):
                set_queue_status(run_id, "expired", "The signal reached its trading-session expiry. Fresh research is required.", True)
                return
            if setting_bool("kill_switch", True) or not setting_bool("trading_enabled", False):
                set_queue_status(run_id, "pending", "Waiting: the dashboard execution gate is closed.")
                return
            if not execution_window_sufficient(1):
                set_queue_status(run_id, "pending", "Waiting for a regular NYSE session with enough time to monitor orders.")
                return
        broker = PaperBroker()
        broker.connect_paper()
        snapshot = broker.portfolio_snapshot()
        with connection() as conn:
            conn.execute("INSERT INTO portfolio_cache(singleton,snapshot,captured_at) VALUES(true,%s::jsonb,now()) "
                         "ON CONFLICT(singleton) DO UPDATE SET snapshot=excluded.snapshot,captured_at=excluded.captured_at",
                         (json.dumps(snapshot, default=str),))
            conn.commit()
        if not reconcile_orders(broker, run_id, snapshot):
            set_queue_status(run_id, "needs_reconciliation", "An earlier submission has no confirmed terminal broker state. It will not be duplicated.")
            return
        if entry["expires_at"] <= datetime.now(UTC):
            set_queue_status(run_id, "expired", "Signal expired; earlier broker orders have now been reconciled.", True)
            return
        if setting_bool("kill_switch", True) or not setting_bool("trading_enabled", False):
            set_queue_status(run_id, "pending", "Waiting: the dashboard execution gate is closed.")
            return
        if not execution_window_sufficient(1):
            set_queue_status(run_id, "pending", "Waiting for a regular NYSE session with enough time to monitor orders.")
            return
        if fetch_one("SELECT id FROM research_runs WHERE status='completed' AND created_at > "
                     "(SELECT created_at FROM research_runs WHERE id=%s) LIMIT 1", (run_id,)):
            set_queue_status(run_id, "superseded", "Newer research is available; prior submissions reconciled.", True)
            return
        context = fetch_one("SELECT research_context FROM research_runs WHERE id=%s", (run_id,))["research_context"] or {}
        attempted = fetch_one("SELECT id FROM orders WHERE run_id=%s LIMIT 1", (run_id,))
        if not attempted and (not context.get("research_data_status", {}).get("portfolio_known") or
                              context.get("account_id") != snapshot["account_id"] or
                              holdings_signature(context) != holdings_signature(snapshot)):
            _request_fresh_research(run_id, "Holdings changed or research had no verified portfolio. New research has been requested.")
            return
        capability = fetch_one("SELECT * FROM broker_status WHERE singleton=true") or {}
        if not capability.get("api_us_stock_order_access"):
            raise RuntimeError("Waiting for the stock paper-order capability check to pass.")
        decisions = fetch_all("SELECT * FROM decisions WHERE run_id=%s ORDER BY created_at", (run_id,))
        for decision in decisions:
            if decision["validation_status"] in FINAL_DECISIONS:
                continue
            if not execution_window_sufficient(1):
                set_queue_status(run_id, "pending", "Remaining decisions are waiting for the next execution window.")
                return
            snapshot = broker.portfolio_snapshot()
            if snapshot["open_orders"]:
                raise RuntimeError("Waiting for other open broker orders to finish before sizing queued trades.")
            confirmed = fetch_all("SELECT * FROM orders WHERE run_id=%s", (run_id,))
            if not holdings_match_fills(context, snapshot, confirmed):
                _request_fresh_research(run_id, "Holdings changed beyond this run's confirmed fills; fresh research requested.")
                return
            _enrich_positions(broker, snapshot)
            if any(p.get("market_data_error") for p in snapshot["positions"] if Decimal(str(p["quantity"])) != 0):
                raise RuntimeError("A current holding cannot be valued safely; queued decisions remain pending.")
            capital = _virtual_capital_context(broker, snapshot)
            _store_snapshot(run_id, snapshot)
            usage = fetch_one("SELECT COALESCE(sum(filled_quantity*COALESCE(average_fill_price,limit_price)),0) AS amount FROM orders WHERE run_id=%s", (run_id,))
            try:
                _execute_decision(broker, run_id, decision, snapshot, Decimal(str(usage["amount"])),
                                  Decimal(str(capital["cash_usd"])), Decimal(str(capital["net_liquidation_usd"])))
            except PolicyViolation as exc:
                with connection() as conn:
                    conn.execute("UPDATE decisions SET validation_status='rejected',validation_message=%s WHERE id=%s", (str(exc), decision["id"]))
                    conn.commit()
                add_event(run_id, "decision.rejected", f"{decision['symbol']}: {exc}")
        save_executions(broker, run_id)
        final = broker.portfolio_snapshot()
        if final["open_orders"]:
            raise RuntimeError("Open orders remain during final reconciliation.")
        _enrich_positions(broker, final)
        _store_snapshot(run_id, final)
        with connection() as conn:
            conn.execute("UPDATE portfolio_cache SET snapshot=%s::jsonb,captured_at=now() WHERE singleton=true",
                         (json.dumps(final, default=str),))
            conn.commit()
        set_queue_status(run_id, "completed", "Paper order statuses, executions and final positions reconciled.", True)
    except Exception as exc:
        status = "needs_reconciliation" if fetch_one("SELECT id FROM orders WHERE run_id=%s AND NOT terminal LIMIT 1", (run_id,)) else "pending"
        set_queue_status(run_id, status, str(exc))
        log.warning("Execution deferred for %s: %s", run_id, exc)
    finally:
        if broker is not None:
            broker.disconnect_paper()


def process_next_execution() -> None:
    with connection() as conn:
        # Any uncertain broker submission has priority and blocks new submissions.
        unresolved = conn.execute("SELECT run_id FROM orders WHERE NOT terminal ORDER BY created_at LIMIT 1").fetchone()
        if unresolved:
            entry = conn.execute("SELECT * FROM execution_queue WHERE run_id=%s AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED", (unresolved["run_id"],)).fetchone()
        else:
            entry = conn.execute("SELECT * FROM execution_queue WHERE status IN ('pending','needs_reconciliation') "
                                 "AND next_attempt_at<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED").fetchone()
        if entry:
            conn.execute("UPDATE execution_queue SET status='executing',attempts=attempts+1,"
                         "started_at=COALESCE(started_at,now()),next_attempt_at=now()+interval '60 seconds' WHERE run_id=%s", (entry["run_id"],))
        conn.commit()
    if entry:
        process_queue_entry(entry)


def retry_reports() -> None:
    for row in fetch_all("SELECT r.id FROM research_runs r WHERE r.status IN ('completed','failed') "
                         "AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.dedupe_key='run-report:'||r.id::text AND n.status='sent') "
                         "ORDER BY r.created_at DESC LIMIT 10"):
        try:
            send_run_report(str(row["id"]))
        except Exception:
            log.exception("Research report retry failed")
    for row in fetch_all("SELECT q.run_id FROM execution_queue q WHERE q.status IN ('completed','expired','superseded','cancelled') "
                         "AND EXISTS(SELECT 1 FROM decisions d WHERE d.run_id=q.run_id AND d.action<>'HOLD') "
                         "AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.dedupe_key='execution-report:'||q.run_id::text AND n.status='sent') "
                         "ORDER BY q.created_at DESC LIMIT 10"):
        try:
            send_run_report(str(row["run_id"]), phase="execution")
        except Exception:
            log.exception("Execution report retry failed")
