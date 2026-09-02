from __future__ import annotations

import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
import pandas_market_calendars as mcal

from app.artifacts import store_json, store_text
from app.broker import PaperBroker, Quote
from app.capital import protected_cash_floor, virtual_cash_available
from app.config import settings
from app.database import add_event, connection, fetch_one, setting_bool
from app.notifications import send_run_report
from app.policy import POLICY, PolicyViolation, asset_type_for_security_type, proposed_order, validate_decision_shape
from app.prompt import research_prompt


def _decimal(value: Any) -> Decimal:
    return Decimal(str(value))


def _execution_window_sufficient(actionable_decisions: int) -> bool:
    if actionable_decisions <= 0:
        return True
    now = datetime.now(UTC)
    schedule = mcal.get_calendar("NYSE").schedule(start_date=now.date(), end_date=now.date())
    if schedule.empty:
        return False
    market_close = schedule.iloc[0]["market_close"].to_pydatetime()
    worst_case = actionable_decisions * POLICY.max_attempts * POLICY.attempt_seconds
    return now + timedelta(seconds=worst_case + 120) <= market_close


def _news_context() -> dict[str, Any]:
    if not settings.news_signal_origin or not settings.news_signal_token:
        return {"available": False, "reason": "News Signal integration is not configured."}
    headers = {"authorization": f"Bearer {settings.news_signal_token}"}
    result: dict[str, Any] = {"available": True}
    with httpx.Client(timeout=20, headers=headers) as client:
        for key, path in {
            "ticker_signals": "/api/ticker-signals?limit=100",
            "recent_results": "/api/results?limit=50",
            "analysis_status": "/api/article-analysis/status",
        }.items():
            try:
                response = client.get(settings.news_signal_origin + path)
                response.raise_for_status()
                result[key] = response.json()
            except Exception as exc:
                result[key] = {"error": str(exc)[:500]}
    return result


def _enrich_positions(broker: PaperBroker, snapshot: dict[str, Any]) -> None:
    for position in snapshot["positions"]:
        if position["sec_type"] not in {"STK", "CRYPTO"} or position["currency"] != "USD":
            position["market_data_error"] = "Unsupported existing holding type; no new order is permitted."
            continue
        try:
            asset_type = asset_type_for_security_type(position["sec_type"])
            contract = broker.resolve_instrument(position["symbol"], asset_type)
            quote = broker.quote(contract)
            quantity = _decimal(position["quantity"])
            position.update({
                "asset_type": asset_type,
                "bid": str(quote.bid),
                "ask": str(quote.ask),
                "last": str(quote.last),
                "market_value": str(quantity * quote.last),
                "portfolio_weight_pct": str(
                    (quantity * quote.last / _decimal(snapshot["net_liquidation"]) * 100)
                    if _decimal(snapshot["net_liquidation"]) > 0 else Decimal("0")
                ),
            })
        except Exception as exc:
            position["market_data_error"] = str(exc)


def _store_snapshot(run_id: str, snapshot: dict[str, Any]) -> str:
    snapshot_id = str(uuid.uuid4())
    with connection() as conn:
        conn.execute(
            "INSERT INTO portfolio_snapshots(id,run_id,account_id,currency,net_liquidation,total_cash,accrued_cash,"
            "available_funds,buying_power,excess_liquidity,positions,open_orders) "
            "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb)",
            (
                snapshot_id, run_id, snapshot["account_id"], snapshot["currency"], snapshot["net_liquidation"],
                snapshot["total_cash"], snapshot["accrued_cash"], snapshot["available_funds"], snapshot["buying_power"],
                snapshot["excess_liquidity"], json.dumps(snapshot["positions"]), json.dumps(snapshot["open_orders"]),
            ),
        )
        conn.execute("UPDATE research_runs SET portfolio_snapshot_id=%s WHERE id=%s", (snapshot_id, run_id))
        conn.commit()
    return snapshot_id


def _position(snapshot: dict[str, Any], symbol: str) -> dict[str, Any] | None:
    return next((item for item in snapshot["positions"] if item["symbol"].upper() == symbol.upper()), None)


def _asset_class_value(snapshot: dict[str, Any], asset_type: str) -> Decimal:
    return sum(
        (_decimal(item.get("market_value", "0")) for item in snapshot["positions"] if item.get("asset_type") == asset_type),
        Decimal("0"),
    )


def _setting_decimal(key: str) -> Decimal:
    row = fetch_one("SELECT value FROM app_settings WHERE key=%s", (key,))
    if not row:
        raise PolicyViolation(f"Capital-protection setting {key} has not been initialized.")
    return _decimal(row["value"])


def _virtual_capital_context(broker: PaperBroker, snapshot: dict[str, Any]) -> dict[str, Decimal | str]:
    principal = _setting_decimal("virtual_cash_reserve_principal")
    accrued_baseline = _setting_decimal("virtual_cash_reserve_accrued_baseline")
    protected_floor = protected_cash_floor(principal, _decimal(snapshot["accrued_cash"]), accrued_baseline)
    available_base_cash = virtual_cash_available(_decimal(snapshot["total_cash"]), protected_floor)
    base_currency = str(snapshot["currency"]).upper()
    fx_contract = broker.resolve_base_to_usd_fx(base_currency)
    base_to_usd = Decimal("1") if fx_contract is None else broker.quote(fx_contract).last
    if base_to_usd <= 0:
        raise PolicyViolation("A valid base-currency-to-USD quote is required before any USD order.")
    held_usd_value = sum(
        (_decimal(item.get("market_value", "0")) for item in snapshot["positions"]), Decimal("0")
    )
    return {
        "base_currency": base_currency,
        "protected_floor": protected_floor,
        "available_base_cash": available_base_cash,
        "base_to_usd": base_to_usd,
        "cash_usd": available_base_cash * base_to_usd,
        "net_liquidation_usd": available_base_cash * base_to_usd + held_usd_value,
    }


def _insert_decisions(run_id: str, output: dict[str, Any]) -> list[dict[str, Any]]:
    action_count = sum(1 for item in output["decisions"] if item["action"] != "HOLD")
    if action_count > POLICY.max_orders_per_run:
        raise PolicyViolation("Codex returned more than five actionable decisions.")
    symbols = [str(item.get("symbol", "")).upper() for item in output["decisions"]]
    if len(symbols) != len(set(symbols)):
        raise PolicyViolation("Codex returned duplicate decisions for the same ticker.")
    stored: list[dict[str, Any]] = []
    with connection() as conn:
        for item in output["decisions"]:
            decision = dict(item)
            decision["symbol"] = decision["symbol"].upper()
            validate_decision_shape(decision)
            decision["id"] = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO decisions(id,run_id,symbol,asset_type,action,target_weight_pct,confidence,thesis,risks,citations) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb)",
                (
                    decision["id"], run_id, decision["symbol"], decision["asset_type"], decision["action"], decision["target_weight_pct"],
                    decision["confidence"], decision["thesis"], json.dumps(decision["risks"]),
                    json.dumps(decision["citations"]),
                ),
            )
            stored.append(decision)
        conn.commit()
    return stored


def _record_validation(decision_id: str, status: str, message: str) -> None:
    with connection() as conn:
        conn.execute(
            "UPDATE decisions SET validation_status=%s,validation_message=%s WHERE id=%s",
            (status, message, decision_id),
        )
        conn.commit()


def _wait_terminal_with_gate(broker: PaperBroker, order_id: int, run_id: str) -> Any:
    deadline = time.monotonic() + POLICY.attempt_seconds
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return broker.cancel_and_wait(order_id)
        try:
            return broker.wait_order(order_id, min(5, max(1, int(remaining))))
        except TimeoutError:
            if setting_bool("kill_switch", True) or not setting_bool("trading_enabled", False):
                add_event(run_id, "order.cancel_requested", "Kill switch engaged; cancelling the working paper order.")
                return broker.cancel_and_wait(order_id)


def _execute_decision(
    broker: PaperBroker,
    run_id: str,
    decision: dict[str, Any],
    snapshot: dict[str, Any],
    turnover_used: Decimal,
    cash_available: Decimal,
    policy_net_liquidation: Decimal,
) -> tuple[Decimal, Decimal]:
    if setting_bool("kill_switch", True) or not setting_bool("trading_enabled", False):
        raise PolicyViolation("The execution gate closed before this decision was submitted.")
    if decision["action"] == "HOLD":
        _record_validation(decision["id"], "accepted_no_order", "HOLD selected; no order is required.")
        return turnover_used, cash_available
    symbol = decision["symbol"]
    asset_type = decision["asset_type"]
    if asset_type == "CRYPTO":
        capability = fetch_one("SELECT crypto_usd_order_access FROM broker_status WHERE singleton=true")
        if not settings.allow_crypto_paper_trading or not capability or not capability.get("crypto_usd_order_access"):
            raise PolicyViolation("BTC/ETH paper execution is unavailable because the dedicated IBKR crypto capability probe has not passed.")
    position = _position(snapshot, symbol)
    current_quantity = _decimal(position["quantity"]) if position else Decimal("0")
    current_value = _decimal(position.get("market_value", "0")) if position else Decimal("0")
    contract = broker.resolve_instrument(symbol, asset_type)
    if contract.currency != "USD" or (asset_type == "US_EQUITY" and contract.secType != "STK") or (asset_type == "CRYPTO" and contract.secType != "CRYPTO"):
        raise PolicyViolation("The resolved contract does not match the approved USD asset type.")
    first_quote = broker.quote(contract)
    proposal = proposed_order(
        decision=decision,
        net_liquidation=policy_net_liquidation,
        cash=cash_available,
        current_quantity=current_quantity,
        current_market_value=current_value,
        asset_class_value=_asset_class_value(snapshot, asset_type),
        bid=first_quote.bid,
        ask=first_quote.ask,
        turnover_used=turnover_used,
    )
    if proposal is None:
        _record_validation(decision["id"], "accepted_no_order", "Target already satisfied or HOLD selected.")
        return turnover_used, cash_available
    _record_validation(decision["id"], "accepted", "Passed contract, market-data, and deterministic risk validation.")

    remaining = _decimal(proposal["quantity"])
    filled_total = Decimal("0")
    executed_notional = Decimal("0")
    base_mid = (first_quote.bid + first_quote.ask) / 2
    for attempt in range(1, POLICY.max_attempts + 1):
        if remaining <= 0:
            break
        if setting_bool("kill_switch", True) or not setting_bool("trading_enabled", False):
            add_event(run_id, "execution.stopped", "The kill switch stopped further order attempts.")
            break
        quote = broker.quote(contract)
        slippage_pct = min(POLICY.max_slippage_pct, POLICY.initial_slippage_pct + Decimal("0.275") * (attempt - 1))
        if proposal["side"] == "BUY":
            price = min(
                quote.ask * (Decimal("1") + slippage_pct / 100),
                base_mid * (Decimal("1") + POLICY.max_slippage_pct / 100),
            )
        else:
            price = max(
                quote.bid * (Decimal("1") - slippage_pct / 100),
                base_mid * (Decimal("1") - POLICY.max_slippage_pct / 100),
            )
        price = price.quantize(Decimal("0.01"))
        order_db_id = str(uuid.uuid4())
        order_ref = f"codex-paper:{run_id[:8]}:{decision['id'][:8]}:{attempt}"
        with connection() as conn:
            conn.execute(
                "INSERT INTO orders(id,run_id,decision_id,order_ref,symbol,side,requested_quantity,remaining_quantity,"
                "limit_price,attempt,status) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'created')",
                (order_db_id, run_id, decision["id"], order_ref, symbol, proposal["side"], remaining, remaining, price, attempt),
            )
            conn.commit()
        broker_order_id = broker.submit_limit_order(contract, proposal["side"], remaining, price, order_ref)
        with connection() as conn:
            conn.execute(
                "UPDATE orders SET broker_order_id=%s,status='submitted',submitted_at=now() WHERE id=%s",
                (broker_order_id, order_db_id),
            )
            conn.commit()
        add_event(run_id, "order.submitted", f"{proposal['side']} {remaining} {symbol} at limit {price}", {"attempt": attempt, "asset_type": asset_type})
        state = _wait_terminal_with_gate(broker, broker_order_id, run_id)
        filled_total += state.filled
        executed_notional += state.filled * (state.avg_fill_price if state.avg_fill_price > 0 else price)
        remaining = max(Decimal("0"), remaining - state.filled)
        with connection() as conn:
            conn.execute(
                "UPDATE orders SET broker_perm_id=%s,status=%s,filled_quantity=%s,remaining_quantity=%s,"
                "average_fill_price=%s,terminal=true,finished_at=now() WHERE id=%s",
                (state.perm_id, state.status, state.filled, state.remaining, state.avg_fill_price, order_db_id),
            )
            conn.commit()
        add_event(run_id, "order.terminal", f"{symbol} attempt {attempt}: {state.status}, filled {state.filled}")
        if state.status == "Inactive":
            break
    if proposal["side"] == "BUY":
        cash_available -= executed_notional
    else:
        cash_available += executed_notional
    return turnover_used + executed_notional, cash_available


def execute_run(run_id: str) -> None:
    broker = PaperBroker()
    started = time.monotonic()
    try:
        with connection() as conn:
            conn.execute("UPDATE research_runs SET status='snapshotting',started_at=now() WHERE id=%s", (run_id,))
            conn.commit()
        add_event(run_id, "run.started", "Capturing the allowlisted IBKR paper portfolio.")
        broker.connect_paper()
        snapshot = broker.portfolio_snapshot()
        _enrich_positions(broker, snapshot)
        capability = fetch_one(
            "SELECT live_us_stock_quotes,delayed_us_stock_quotes,api_us_stock_order_access,crypto_usd_order_access "
            "FROM broker_status WHERE singleton=true"
        ) or {}
        snapshot["execution_capabilities"] = capability
        capital = _virtual_capital_context(broker, snapshot)
        snapshot["capital_protection"] = {
            "base_currency": capital["base_currency"],
            "protected_cash_floor": str(capital["protected_floor"]),
            "available_base_cash": str(capital["available_base_cash"]),
            "base_to_usd": str(capital["base_to_usd"]),
            "virtual_cash_usd": str(capital["cash_usd"]),
            "virtual_net_liquidation_usd": str(capital["net_liquidation_usd"]),
        }
        _store_snapshot(run_id, snapshot)
        news_context = _news_context()
        prompt = research_prompt(snapshot, news_context)
        prompt_artifact = store_text(run_id, "prompt", prompt)
        with connection() as conn:
            conn.execute(
                "UPDATE research_runs SET status='researching',prompt_path=%s,prompt_sha256=%s,artifact_bytes=%s WHERE id=%s",
                (prompt_artifact.path, prompt_artifact.sha256, prompt_artifact.bytes, run_id),
            )
            conn.commit()
        add_event(run_id, "research.started", "Codex deep-dive research started with a two-hour ceiling.")
        response = httpx.post(
            settings.codex_runner_url,
            json={"run_id": run_id, "prompt": prompt},
            timeout=settings.codex_timeout_seconds + 120,
        )
        response.raise_for_status()
        payload = response.json()
        output = payload["result"]
        output_artifact = store_json(run_id, "output", output)
        event_artifact = store_json(run_id, "codex-events", payload.get("events", []))
        usage = payload.get("usage", {})
        with connection() as conn:
            conn.execute(
                "UPDATE research_runs SET status='validating',output_path=%s,event_path=%s,output_sha256=%s,"
                "input_tokens=%s,output_tokens=%s,cached_input_tokens=%s,codex_runtime_seconds=%s,"
                "decision_summary=%s,artifact_bytes=artifact_bytes+%s WHERE id=%s",
                (
                    output_artifact.path, event_artifact.path, output_artifact.sha256,
                    usage.get("input_tokens", 0), usage.get("output_tokens", 0), usage.get("cached_input_tokens", 0),
                    payload.get("runtime_seconds", 0), output["run_summary"], output_artifact.bytes + event_artifact.bytes, run_id,
                ),
            )
            conn.commit()
        decisions = _insert_decisions(run_id, output)
        add_event(run_id, "research.completed", output["run_summary"], {"decisions": len(decisions), "usage": usage})

        actionable = sum(1 for decision in decisions if decision["action"] != "HOLD")
        execution_window_open = _execution_window_sufficient(actionable)
        if setting_bool("kill_switch", True) or not setting_bool("trading_enabled", False):
            for decision in decisions:
                _record_validation(decision["id"], "blocked", "Trading is disabled or the kill switch is engaged.")
            add_event(run_id, "execution.blocked", "Research was recorded, but the paper execution gate is closed.")
        elif not execution_window_open:
            for decision in decisions:
                _record_validation(decision["id"], "blocked", "Insufficient regular-session time remains for monitored execution.")
            add_event(
                run_id,
                "execution.blocked",
                "Research was recorded, but worst-case monitored order handling would extend beyond the NYSE close.",
            )
        else:
            with connection() as conn:
                conn.execute("UPDATE research_runs SET status='executing' WHERE id=%s", (run_id,))
                conn.commit()
            turnover = Decimal("0")
            cash_available = _decimal(capital["cash_usd"])
            policy_net_liquidation = _decimal(capital["net_liquidation_usd"])
            for decision in decisions:
                try:
                    turnover, cash_available = _execute_decision(
                        broker, run_id, decision, snapshot, turnover, cash_available, policy_net_liquidation,
                    )
                except PolicyViolation as exc:
                    _record_validation(decision["id"], "rejected", str(exc))
                    add_event(run_id, "decision.rejected", f"{decision['symbol']}: {exc}")

        with connection() as conn:
            conn.execute("UPDATE research_runs SET status='reconciling' WHERE id=%s", (run_id,))
            conn.commit()
        final_snapshot = broker.portfolio_snapshot()
        _enrich_positions(broker, final_snapshot)
        _store_snapshot(run_id, final_snapshot)
        executions = broker.executions()
        with connection() as conn:
            for execution in executions:
                conn.execute(
                    "INSERT INTO executions(exec_id,order_id,account_id,symbol,side,shares,price,executed_at,raw) "
                    "VALUES(%s,(SELECT id FROM orders WHERE broker_order_id=%s ORDER BY created_at DESC LIMIT 1),"
                    "%s,%s,%s,%s,%s,now(),%s::jsonb) ON CONFLICT(exec_id) DO NOTHING",
                    (
                        execution["exec_id"], execution["order_id"], execution["account"], execution["symbol"], execution["side"],
                        execution["shares"], execution["price"], json.dumps(execution),
                    ),
                )
            conn.execute(
                "UPDATE research_runs SET status='completed',finished_at=now(),runtime_seconds=%s WHERE id=%s",
                (round(time.monotonic() - started, 3), run_id),
            )
            conn.commit()
        add_event(run_id, "run.completed", "Paper account, terminal orders, executions, and final positions were reconciled.")
        if not send_run_report(run_id):
            add_event(run_id, "notification.failed", "The completion report email could not be delivered.")
    except Exception as exc:
        message = str(exc)[:12000]
        with connection() as conn:
            conn.execute(
                "UPDATE research_runs SET status='failed',finished_at=now(),runtime_seconds=%s,error=%s WHERE id=%s",
                (round(time.monotonic() - started, 3), message, run_id),
            )
            conn.execute(
                "INSERT INTO app_settings(key,value) VALUES('kill_switch','true'::jsonb) "
                "ON CONFLICT(key) DO UPDATE SET value='true'::jsonb,updated_at=now()"
            )
            conn.commit()
        add_event(run_id, "run.failed", message)
        send_run_report(run_id)
        raise
    finally:
        broker.disconnect_paper()


def queue_run(scheduled_for: datetime, trigger: str) -> str:
    run_id = str(uuid.uuid4())
    with connection() as conn:
        conn.execute(
            "INSERT INTO research_runs(id,scheduled_for,status,trigger,model,reasoning_effort) "
            "VALUES(%s,%s,'queued',%s,%s,%s)",
            (run_id, scheduled_for, trigger, settings.codex_model, settings.codex_reasoning_effort),
        )
        conn.commit()
    return run_id
