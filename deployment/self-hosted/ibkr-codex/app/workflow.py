from __future__ import annotations

import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from pathlib import Path

import httpx
import pandas_market_calendars as mcal

from app.artifacts import read_artifact, store_json, store_text
from app.broker import PaperBroker, Quote
from app.capital import protected_cash_floor, virtual_cash_available
from app.config import settings
from app.database import add_event, connection, fetch_all, fetch_one, setting_bool
from app.notifications import send_run_report
from app.policy import POLICY, PolicyViolation, asset_type_for_security_type, proposed_order, validate_decision_shape
from app.prompt import research_prompt
from app.schedule import execution_window_sufficient


def _decimal(value: Any) -> Decimal:
    return Decimal(str(value))


def _execution_window_sufficient(actionable_decisions: int) -> bool:
    return execution_window_sufficient(actionable_decisions)


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
        if position["sec_type"] != "STK" or position["currency"] != "USD":
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
    reserve_currency = fetch_one("SELECT value FROM app_settings WHERE key='virtual_cash_reserve_currency'")
    if not reserve_currency or str(reserve_currency["value"]).upper() != str(snapshot["currency"]).upper():
        raise PolicyViolation("Account base currency changed; capital reserve must be revalidated.")
    principal = _setting_decimal("virtual_cash_reserve_principal")
    accrued_baseline = _setting_decimal("virtual_cash_reserve_accrued_baseline")
    protected_floor = protected_cash_floor(principal, _decimal(snapshot["accrued_cash"]), accrued_baseline)
    available_base_cash = virtual_cash_available(_decimal(snapshot["total_cash"]), protected_floor)
    base_currency = str(snapshot["currency"]).upper()
    fx_contract = broker.resolve_base_to_usd_fx(base_currency)
    base_to_usd = Decimal("1") if fx_contract is None else broker.quote(fx_contract).bid
    if not base_to_usd.is_finite() or base_to_usd <= 0:
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
    existing = fetch_all("SELECT * FROM decisions WHERE run_id=%s ORDER BY created_at", (run_id,))
    if existing:
        return existing  # Same immutable result after a worker restart; never duplicate decisions.
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
        raise RuntimeError("The execution gate closed; decision remains queued.")
    if decision["action"] == "HOLD":
        _record_validation(decision["id"], "accepted_no_order", "HOLD selected; no order is required.")
        return turnover_used, cash_available
    validate_decision_shape(decision)
    symbol = decision["symbol"]
    asset_type = decision["asset_type"]
    position = _position(snapshot, symbol)
    current_quantity = _decimal(position["quantity"]) if position else Decimal("0")
    current_value = _decimal(position.get("market_value", "0")) if position else Decimal("0")
    contract = broker.resolve_instrument(symbol, asset_type)
    if contract.currency != "USD" or contract.secType != "STK":
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
    prior = fetch_all("SELECT * FROM orders WHERE decision_id=%s ORDER BY attempt", (decision["id"],))
    if any(not item["terminal"] for item in prior):
        raise RuntimeError("A previous attempt must be reconciled before any new submission.")
    filled_total = sum((_decimal(item["filled_quantity"]) for item in prior), Decimal("0"))
    if proposal is None:
        _record_validation(decision["id"], "executed" if filled_total else "accepted_no_order",
                           f"Target satisfied; prior confirmed fills: {filled_total}. No further order required.")
        return turnover_used, cash_available
    _record_validation(decision["id"], "accepted", "Passed contract, market-data, and deterministic risk validation.")

    remaining = _decimal(proposal["quantity"])
    if prior:
        remaining = min(remaining, max(Decimal("0"), _decimal(prior[0]["requested_quantity"]) - filled_total))
    start_attempt = max((item["attempt"] for item in prior), default=0) + 1
    executed_notional = Decimal("0")
    base_mid = (first_quote.bid + first_quote.ask) / 2
    for attempt in range(start_attempt, POLICY.max_attempts + 1):
        if remaining <= 0:
            break
        if setting_bool("kill_switch", True) or not setting_bool("trading_enabled", False):
            raise RuntimeError("The kill switch paused further order attempts; decision remains queued.")
        expiry = fetch_one("SELECT expires_at FROM execution_queue WHERE run_id=%s", (run_id,))
        if not expiry or expiry["expires_at"] <= datetime.now(UTC) or not execution_window_sufficient(1):
            raise RuntimeError("Signal expired or the regular-session execution window closed.")
        if fetch_one("SELECT id FROM research_runs WHERE status='completed' AND created_at > "
                     "(SELECT created_at FROM research_runs WHERE id=%s) LIMIT 1", (run_id,)):
            raise RuntimeError("Newer research supersedes this signal; no further submissions.")
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
        order_ref = f"codex-paper:{str(run_id)[:8]}:{str(decision['id'])[:8]}:{attempt}"
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
    status = "executed" if remaining <= 0 else "partially_filled" if filled_total > 0 else "unfilled"
    _record_validation(decision["id"], status, f"Confirmed filled {filled_total}; unfilled {remaining}; broker attempts monitored.")
    if proposal["side"] == "BUY":
        cash_available -= executed_notional
    else:
        cash_available += executed_notional
    return turnover_used + executed_notional, cash_available


def research_context() -> dict[str, Any]:
    """Read saved inputs only. Market data and broker connectivity are execution concerns."""
    cached = fetch_one("SELECT snapshot,captured_at FROM portfolio_cache WHERE singleton=true")
    if cached:
        snapshot = dict(cached["snapshot"])
        captured = cached["captured_at"]
        metadata = {
            "portfolio_known": True, "source": "last_saved_ibkr_snapshot",
            "captured_at": captured.isoformat(),
            "age_seconds": max(0, round((datetime.now(UTC) - captured).total_seconds())),
            "note": "Saved holdings may be stale. Research independently using current public sources. Execution will refresh and verify all holdings.",
        }
    else:
        snapshot = {"positions": [], "currency": None, "total_cash": None, "net_liquidation": None}
        metadata = {
            "portfolio_known": False, "source": "unavailable", "captured_at": None,
            "note": "No trustworthy saved portfolio exists. Discover candidates; do not assume that the account is empty.",
        }
    snapshot["research_data_status"] = metadata
    capital = fetch_one("SELECT value FROM app_settings WHERE key='virtual_investable_capital'")
    currency = fetch_one("SELECT value FROM app_settings WHERE key='virtual_cash_reserve_currency'")
    snapshot["strategy_budget"] = {
        "initial_capital": capital["value"] if capital else settings.virtual_investable_capital,
        "currency": currency["value"] if currency else "account base currency",
        "note": "All target weights apply to this virtual portfolio, never to the full broker balance. Fresh FX and protected cash checks run at execution.",
    }
    return snapshot


def execute_run(run_id: str) -> None:
    """Complete research and persist intents without constructing a PaperBroker."""
    from app.schedule import decision_expiry
    started = time.monotonic()
    try:
        with connection() as conn:
            claimed = conn.execute(
                "UPDATE research_runs SET status='snapshotting',started_at=COALESCE(started_at,now()),error=NULL "
                "WHERE id=%s AND status='queued' RETURNING id", (run_id,)).fetchone()
            conn.commit()
        if not claimed:
            return
        previous = fetch_one("SELECT research_context,prompt_path FROM research_runs WHERE id=%s", (run_id,))
        if previous["research_context"] and previous["prompt_path"]:
            snapshot = previous["research_context"]
            prompt = read_artifact(previous["prompt_path"])
        else:
            snapshot = research_context()
            prompt = research_prompt(snapshot, _news_context())
        add_event(run_id, "run.started", "Research is using saved portfolio context independently of IBKR.",
                  snapshot["research_data_status"])
        prompt_artifact = store_text(run_id, "prompt", prompt)
        with connection() as conn:
            conn.execute(
                "UPDATE research_runs SET status='researching',research_context=%s::jsonb,"
                "prompt_path=%s,prompt_sha256=%s,artifact_bytes=%s WHERE id=%s",
                (json.dumps(snapshot, default=str), prompt_artifact.path, prompt_artifact.sha256, prompt_artifact.bytes, run_id))
            conn.commit()
        add_event(run_id, "research.started", "Codex deep-dive research started with a two-hour ceiling.")
        response = httpx.post(settings.codex_runner_url, json={"run_id": run_id, "prompt": prompt},
                              timeout=settings.codex_timeout_seconds + 120)
        if response.status_code == 429:
            with connection() as conn:
                conn.execute("UPDATE research_runs SET status='queued',error='Research runner is busy; retrying.' WHERE id=%s", (run_id,))
                conn.commit()
            return
        if response.is_error:
            raise RuntimeError(f"Research runner returned {response.status_code}: {response.text[:4000]}")
        payload = response.json()
        output = payload.get("result")
        output_artifact = store_json(run_id, "output", output if output is not None else {"error": payload.get("error")})
        runner_path = settings.artifact_root / "runner-results" / f"{run_id}.json.gz"
        runner_bytes = runner_path.stat().st_size if runner_path.exists() else 0
        event_artifact = store_json(run_id, "codex-events", payload.get("events", []))
        usage = payload.get("usage", {})
        with connection() as conn:
            conn.execute(
                "UPDATE research_runs SET status='validating',output_path=%s,event_path=%s,output_sha256=%s,"
                "input_tokens=%s,output_tokens=%s,cached_input_tokens=%s,codex_runtime_seconds=%s,"
                "decision_summary=%s,artifact_bytes=artifact_bytes+%s,runner_result_path=%s WHERE id=%s",
                (output_artifact.path, event_artifact.path, output_artifact.sha256,
                 usage.get("input_tokens", 0), usage.get("output_tokens", 0), usage.get("cached_input_tokens", 0),
                 payload.get("runtime_seconds", 0), output.get("run_summary") if output else None,
                 output_artifact.bytes + event_artifact.bytes + runner_bytes, str(runner_path) if runner_bytes else None, run_id))
            conn.commit()
        if payload.get("ok") is False or output is None:
            raise RuntimeError(payload.get("error", "Research returned no result."))
        decisions = _insert_decisions(run_id, output)
        actionable = sum(item["action"] != "HOLD" for item in decisions)
        with connection() as conn:
            # New research replaces older intents only when they have never reached IBKR.
            conn.execute(
                "UPDATE execution_queue q SET status='superseded',reason='Replaced by newer completed research.',finished_at=now() "
                "WHERE status='pending' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.run_id=q.run_id)")
            conn.execute(
                "INSERT INTO execution_queue(run_id,status,reason,expires_at,finished_at) "
                "VALUES(%s,%s,%s,%s,CASE WHEN %s THEN NULL ELSE now() END) ON CONFLICT(run_id) DO NOTHING",
                (run_id, "pending" if actionable else "completed",
                 "Awaiting fresh broker checks and an execution window." if actionable else "HOLD: no orders required.",
                 decision_expiry(datetime.fromisoformat(payload["completed_at"]) if payload.get("completed_at") else datetime.now(UTC)), bool(actionable)))
            conn.execute(
                "UPDATE decisions SET validation_status=CASE WHEN action='HOLD' THEN 'accepted_no_order' ELSE 'queued' END,"
                "validation_message=CASE WHEN action='HOLD' THEN 'HOLD selected; no order required.' "
                "ELSE 'Queued for fresh IBKR portfolio, FX, quote and risk checks.' END WHERE run_id=%s", (run_id,))
            conn.execute(
                "UPDATE research_runs SET status='completed',finished_at=now(),runtime_seconds=%s WHERE id=%s",
                (round(time.monotonic() - started, 3), run_id))
            conn.commit()
        add_event(run_id, "research.completed", output["run_summary"], {"decisions": len(decisions), "usage": usage})
        add_event(run_id, "execution.queued" if actionable else "execution.no_action",
                  f"{actionable} trade decisions queued." if actionable else "Research chose no paper trades.")
    except httpx.TransportError as exc:
        with connection() as conn:
            conn.execute("UPDATE research_runs SET status='queued',error=%s WHERE id=%s",
                         (f"Research transport interrupted; retrieving durable result on retry: {exc}"[:4000], run_id))
            conn.commit()
        add_event(run_id, "research.retry", "Runner connection interrupted; saved prompt and result will be reused.")
        return
    except Exception as exc:
        message = str(exc)[:12000]
        with connection() as conn:
            conn.execute(
                "UPDATE research_runs SET status='failed',finished_at=now(),runtime_seconds=%s,error=%s WHERE id=%s",
                (round(time.monotonic() - started, 3), message, run_id))
            conn.commit()
        add_event(run_id, "research.failed", message)
        # A research/transport failure never toggles the trading kill switch.
    try:
        send_run_report(run_id)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Research report email failed; research artifacts remain saved")


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
