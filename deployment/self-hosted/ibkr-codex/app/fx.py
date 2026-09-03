"""Conservative, auditable FX fallback sourced from official ECB reference rates."""
from __future__ import annotations

import csv
import hashlib
import io
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import httpx

from app.config import settings
from app.database import connection, fetch_one

ECB_ORIGIN = "https://data-api.ecb.europa.eu"


@dataclass(frozen=True)
class ExternalFxRate:
    base_currency: str
    quote_currency: str
    rate: Decimal
    observation_date: date
    retrieved_at: datetime
    source: str
    response_sha256: str


def _valid_age(observation_date: date, today: date) -> bool:
    age = (today - observation_date).days
    return 0 <= age <= settings.fx_fallback_max_age_days


def _cached(base: str, quote: str, *, fresh_only: bool) -> ExternalFxRate | None:
    row = fetch_one(
        "SELECT * FROM fx_rate_cache WHERE base_currency=%s AND quote_currency=%s",
        (base, quote),
    )
    if not row or not _valid_age(row["observation_date"], datetime.now(UTC).date()):
        return None
    rate = Decimal(str(row["rate"]))
    if not rate.is_finite() or not Decimal("0.1") < rate < Decimal("10") or row["source"] != "ECB reference rate":
        return None
    if fresh_only and row["retrieved_at"] < datetime.now(UTC) - timedelta(hours=settings.fx_fallback_cache_hours):
        return None
    return ExternalFxRate(base, quote, rate, row["observation_date"],
                          row["retrieved_at"], row["source"] + " (cache)", row["response_sha256"])


def _parse_ecb_cross(payload: bytes, base: str, quote: str) -> tuple[Decimal, date]:
    if len(payload) > 500_000:
        raise RuntimeError("ECB FX response exceeded the safety limit.")
    rows = list(csv.DictReader(io.StringIO(payload.decode("utf-8-sig"))))
    latest: dict[str, tuple[date, Decimal]] = {}
    for row in rows:
        currency = row.get("CURRENCY", "").upper()
        if currency not in {base, quote} or row.get("CURRENCY_DENOM") != "EUR":
            continue
        observed = date.fromisoformat(row["TIME_PERIOD"])
        value = Decimal(row["OBS_VALUE"])
        if not value.is_finite() or not Decimal("0.1") < value < Decimal("10"):
            continue
        if currency not in latest or observed > latest[currency][0]:
            latest[currency] = (observed, value)
    if set(latest) != {base, quote} or latest[base][0] != latest[quote][0]:
        raise RuntimeError("ECB did not return matching reference dates for the FX cross.")
    observed = latest[base][0]
    if not _valid_age(observed, datetime.now(UTC).date()):
        raise RuntimeError("ECB FX reference rate is outside the permitted age window.")
    rate = latest[quote][1] / latest[base][1]
    if not rate.is_finite() or not Decimal("0.1") < rate < Decimal("10"):
        raise RuntimeError("ECB returned an implausible FX cross rate.")
    return rate, observed


def external_fx_rate(base: str, quote: str = "USD") -> ExternalFxRate:
    base, quote = base.upper(), quote.upper()
    if base == quote:
        now = datetime.now(UTC)
        return ExternalFxRate(base, quote, Decimal("1"), now.date(), now, "identity", "")
    if {base, quote} - {"AUD", "USD"}:
        raise RuntimeError("The external FX fallback is allowlisted only for AUD/USD.")
    recent = _cached(base, quote, fresh_only=True)
    if recent:
        return recent
    start = datetime.now(UTC).date() - timedelta(days=7)
    series = "+".join((base, quote))
    url = f"{ECB_ORIGIN}/service/data/EXR/D.{series}.EUR.SP00.A"
    try:
        response = httpx.get(url, params={"startPeriod": start.isoformat(), "format": "csvdata"},
                             timeout=20, follow_redirects=False)
        response.raise_for_status()
        if "text/csv" not in response.headers.get("content-type", ""):
            raise RuntimeError("ECB FX endpoint returned an unexpected content type.")
        rate, observed = _parse_ecb_cross(response.content, base, quote)
        digest = hashlib.sha256(response.content).hexdigest()
        now = datetime.now(UTC)
        with connection() as conn:
            conn.execute(
                "INSERT INTO fx_rate_cache(base_currency,quote_currency,rate,observation_date,retrieved_at,source,response_sha256) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(base_currency,quote_currency) DO UPDATE SET "
                "rate=excluded.rate,observation_date=excluded.observation_date,retrieved_at=excluded.retrieved_at,"
                "source=excluded.source,response_sha256=excluded.response_sha256",
                (base, quote, rate, observed, now, "ECB reference rate", digest),
            )
            conn.commit()
        return ExternalFxRate(base, quote, rate, observed, now, "ECB reference rate", digest)
    except Exception as exc:
        stale = _cached(base, quote, fresh_only=False)
        if stale:
            return ExternalFxRate(stale.base_currency, stale.quote_currency, stale.rate, stale.observation_date,
                                  stale.retrieved_at, stale.source + f"; refresh failed: {type(exc).__name__}", stale.response_sha256)
        raise RuntimeError(f"Official ECB FX fallback unavailable: {exc}") from exc

