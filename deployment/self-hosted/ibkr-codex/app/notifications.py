from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import quote

import httpx

from app.config import settings
from app.database import connection, fetch_all, fetch_one


def create_validation_link() -> str:
    raw = secrets.token_urlsafe(32)
    digest = hashlib.sha256(raw.encode()).hexdigest()
    with connection() as conn:
        conn.execute("DELETE FROM validation_links WHERE expires_at < now()")
        conn.execute(
            "INSERT INTO validation_links(id,token_hash,expires_at) VALUES(%s,%s,%s)",
            (uuid.uuid4(), digest, datetime.now(UTC) + timedelta(hours=2)),
        )
        conn.commit()
    return f"{settings.public_base_url}/account-validation?t={quote(raw)}"


def validation_token_valid(raw: str) -> bool:
    digest = hashlib.sha256(raw.encode()).hexdigest()
    row = fetch_one(
        "SELECT id FROM validation_links WHERE token_hash=%s AND expires_at>now()",
        (digest,),
    )
    return bool(row)


def send_email(kind: str, dedupe_key: str, subject: str, text: str, link: str | None = None) -> bool:
    existing = fetch_one("SELECT status FROM notifications WHERE dedupe_key=%s", (dedupe_key,))
    if existing and existing["status"] == "sent":
        return True
    notification_id = uuid.uuid4()
    with connection() as conn:
        conn.execute(
            "INSERT INTO notifications(id,kind,dedupe_key,destination,status) VALUES(%s,%s,%s,%s,'sending') "
            "ON CONFLICT(dedupe_key) DO UPDATE SET status='sending',error=NULL",
            (notification_id, kind, dedupe_key, settings.email_to),
        )
        conn.commit()
    if not settings.notification_url or not settings.notification_token:
        error = "Notification endpoint is not configured."
        ok = False
    else:
        try:
            response = httpx.post(
                settings.notification_url,
                headers={"authorization": f"Bearer {settings.notification_token}"},
                json={
                    "to": settings.email_to,
                    "subject": subject,
                    "text": text,
                    "link": link,
                },
                timeout=30,
            )
            response.raise_for_status()
            ok, error = True, None
        except Exception as exc:
            ok, error = False, str(exc)[:2000]
    with connection() as conn:
        conn.execute(
            "UPDATE notifications SET status=%s,error=%s,sent_at=CASE WHEN %s THEN now() ELSE NULL END "
            "WHERE dedupe_key=%s",
            ("sent" if ok else "failed", error, ok, dedupe_key),
        )
        conn.commit()
    return ok


def send_gateway_reminder() -> bool:
    bucket = int(datetime.now(UTC).timestamp() // max(60, settings.email_reminder_seconds))
    dedupe_key = f"gateway-validation:{bucket}"
    legacy_key = f"gateway-validation:{datetime.now(UTC).strftime('%Y%m%dT%H')}"
    existing = fetch_one(
        "SELECT status FROM notifications WHERE dedupe_key IN (%s,%s) AND status='sent' LIMIT 1",
        (dedupe_key, legacy_key),
    )
    if existing and existing["status"] == "sent":
        return True
    link = create_validation_link()
    sent = send_email(
        "gateway_validation",
        dedupe_key,
        "IBKR paper account authentication required",
        "The paper-trading gateway is not authenticated. Open the protected validation link and complete the IBKR login/2FA. Another reminder will be sent in one hour if it remains disconnected.",
        link,
    )
    if sent:
        with connection() as conn:
            conn.execute("UPDATE broker_status SET last_reminder_at=now() WHERE singleton=true")
            conn.commit()
    return sent


def send_capability_reminder(message: str) -> bool:
    bucket = int(datetime.now(UTC).timestamp() // max(60, settings.email_reminder_seconds))
    dedupe_key = f"gateway-capability:{bucket}"
    existing = fetch_one("SELECT status FROM notifications WHERE dedupe_key=%s", (dedupe_key,))
    if existing and existing["status"] == "sent":
        return True
    link = create_validation_link()
    return send_email(
        "gateway_capability",
        dedupe_key,
        "IBKR paper API setup needs attention",
        "The funded paper account is readable, but autonomous execution remains locked because an API capability check failed. Open the protected gateway, confirm API order access is not read-only and live US-stock market data is available.\n\n" + message,
        link,
    )


def send_failure(run_id: str, message: str) -> bool:
    return send_email(
        "run_failure",
        f"run-failure:{run_id}",
        "IBKR Codex paper-trading run failed",
        f"Run {run_id} failed closed. No further orders will be submitted until the cause is resolved.\n\n{message}",
        f"{settings.public_base_url}/?run={run_id}",
    )


def _short(value: object, limit: int = 1_200) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _decimal(value: object) -> Decimal:
    try:
        parsed = Decimal(str(value or "0"))
        return parsed if parsed.is_finite() else Decimal("0")
    except (InvalidOperation, ValueError):
        return Decimal("0")


def order_fill_summary(
    execution_status: str,
    decisions: list[dict[str, object]],
    orders: list[dict[str, object]],
) -> dict[str, object]:
    """Return an email-safe fill outcome from persisted, reconciled state."""
    actionable = [item for item in decisions if str(item.get("action", "HOLD")).upper() != "HOLD"]
    satisfied = [
        item for item in actionable
        if str(item.get("validation_status", "")) in {"executed", "accepted_no_order"}
    ]
    submitted = sum((_decimal(item.get("requested_quantity")) for item in orders), Decimal("0"))
    filled = sum((_decimal(item.get("filled_quantity")) for item in orders), Decimal("0"))
    terminal = execution_status in {"completed", "expired", "superseded", "cancelled"}

    if not actionable:
        outcome = "no_orders"
        headline = "ORDER FILL STATUS: NO ORDERS REQUESTED"
    elif len(satisfied) == len(actionable):
        outcome = "filled"
        if orders:
            headline = (
                f"ORDER FILL STATUS: FILLED — {len(satisfied)}/{len(actionable)} decisions satisfied; "
                f"{filled}/{submitted} submitted shares filled"
            )
        else:
            headline = (
                f"ORDER FILL STATUS: SATISFIED WITHOUT AN ORDER — "
                f"{len(satisfied)}/{len(actionable)} decisions already met their targets"
            )
    elif terminal and filled > 0:
        outcome = "unfilled"
        headline = (
            f"ORDER FILL STATUS: PARTIALLY FILLED — {len(satisfied)}/{len(actionable)} decisions satisfied; "
            f"{filled}/{submitted} submitted shares filled"
        )
    elif terminal:
        outcome = "unfilled"
        headline = (
            f"ORDER FILL STATUS: NOT FILLED — {len(satisfied)}/{len(actionable)} decisions satisfied; "
            f"{filled}/{submitted} submitted shares filled"
        )
    else:
        outcome = "pending"
        headline = (
            f"ORDER FILL STATUS: PENDING — {len(satisfied)}/{len(actionable)} decisions satisfied; "
            f"{filled}/{submitted} submitted shares filled"
        )
    return {
        "outcome": outcome,
        "headline": headline,
        "actionable": len(actionable),
        "satisfied": len(satisfied),
        "submitted": submitted,
        "filled": filled,
    }


def format_run_report(
    run: dict[str, object],
    decisions: list[dict[str, object]],
    orders: list[dict[str, object]],
    executions: list[dict[str, object]],
) -> str:
    """Produce a compact, complete email while the dashboard retains raw artifacts."""
    completed = str(run.get("status")) == "completed"
    outcome = "completed" if completed else f"ended {run.get('status', 'unknown')}"
    fill = order_fill_summary(str(run.get("execution_status", "not started")), decisions, orders)
    lines = [
        str(fill["headline"]),
        f"Queue status: {run.get('execution_status', 'not started')} — {run.get('execution_reason', '')}",
        "",
        f"IBKR Codex paper-trading research {outcome}.",
        "All activity is confined to the allowlisted IBKR paper account.",
        "",
        f"Run: {run.get('id')}",
        f"Trigger: {run.get('trigger', 'unknown')}",
        f"Execution: {run.get('execution_status', 'not started')} — {run.get('execution_reason', '')}",
        f"Runtime: {run.get('runtime_seconds', 0)}s total; {run.get('codex_runtime_seconds', 0)}s Codex",
        "Tokens: "
        f"{run.get('input_tokens', 0)} input / {run.get('output_tokens', 0)} output / "
        f"{run.get('cached_input_tokens', 0)} cached input",
        "",
        "Research summary:",
        _short(run.get("decision_summary") or run.get("error") or "No research summary was recorded."),
        "",
        "Decisions:",
    ]
    if not decisions:
        lines.append("- No decisions were recorded.")
    for item in decisions:
        lines.append(
            f"- {item.get('symbol')} {item.get('action')} | target {item.get('target_weight_pct')}% | "
            f"sleeve {item.get('allocation_bucket', 'DOMESTIC_DIVERSIFIED')} | "
            f"confidence {item.get('confidence')} | {item.get('validation_status')}"
        )
        if item.get("thesis"):
            lines.append(f"  Thesis: {_short(item['thesis'])}")
        if item.get("validation_message"):
            lines.append(f"  Validation: {_short(item['validation_message'], 500)}")
    lines.extend(["", "Paper-order actions:"])
    if not orders:
        lines.append("- No paper orders were submitted.")
    for item in orders:
        lines.append(
            f"- {item.get('symbol')} {item.get('side')} {item.get('requested_quantity')} @ "
            f"{item.get('limit_price')} | attempt {item.get('attempt')} | {item.get('status')} | "
            f"filled {item.get('filled_quantity')} / remaining {item.get('remaining_quantity')}"
        )
        if item.get("error"):
            lines.append(f"  Order detail: {_short(item['error'], 500)}")
    lines.extend(["", "Executions:"])
    if not executions:
        lines.append("- No paper executions were reported.")
    for item in executions:
        lines.append(f"- {item.get('symbol')} {item.get('side')} {item.get('shares')} @ {item.get('price')}")
    lines.extend(["", f"Dashboard: {settings.public_base_url}"])
    return "\n".join(lines)


def send_run_report(run_id: str, phase: str = "research") -> bool:
    run = fetch_one("SELECT * FROM research_runs WHERE id=%s", (run_id,))
    if not run:
        return False
    queue = fetch_one("SELECT status,reason FROM execution_queue WHERE run_id=%s", (run_id,))
    run["execution_status"] = queue["status"] if queue else "not started"
    run["execution_reason"] = queue["reason"] if queue else "No queued orders."
    decisions = fetch_all("SELECT * FROM decisions WHERE run_id=%s ORDER BY created_at", (run_id,))
    orders = fetch_all("SELECT * FROM orders WHERE run_id=%s ORDER BY created_at", (run_id,))
    executions = fetch_all("SELECT * FROM executions WHERE order_id IN (SELECT id FROM orders WHERE run_id=%s) ORDER BY executed_at", (run_id,))
    completed = run["status"] == "completed"
    dedupe_key = f"run-report:{run_id}"
    subject = "IBKR Codex paper research completed" if completed else "IBKR Codex paper-trading run failed"
    if phase == "execution":
        fill = order_fill_summary(str(run["execution_status"]), decisions, orders)
        if fill["outcome"] == "unfilled":
            dedupe_key = f"execution-unfilled:{run_id}"
            subject = "IBKR paper orders were not filled"
        else:
            prior_failure = fetch_one(
                "SELECT status FROM notifications WHERE dedupe_key=%s AND status='sent'",
                (f"execution-unfilled:{run_id}",),
            )
            legacy_report = fetch_one(
                "SELECT status FROM notifications WHERE dedupe_key=%s AND status='sent'",
                (f"execution-report:{run_id}",),
            )
            # Do not resend successful historical reports solely because the
            # outcome-specific keys were introduced. A recovered failed queue
            # is different: it must always generate the requested follow-up.
            if legacy_report and not prior_failure:
                return True
            dedupe_key = f"execution-filled:{run_id}"
            subject = (
                "IBKR paper orders filled — follow-up"
                if prior_failure else "IBKR Codex paper execution completed"
            )
    return send_email(
        "run_report",
        dedupe_key,
        subject,
        format_run_report(run, decisions, orders, executions),
        settings.public_base_url,
    )
