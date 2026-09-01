from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

import httpx

from app.config import settings
from app.database import connection, fetch_one


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
