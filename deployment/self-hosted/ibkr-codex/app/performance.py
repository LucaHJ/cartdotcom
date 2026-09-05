"""Independent, display-only performance for the protected strategy slice.

These prices never enter order sizing or execution. The deterministic executor
continues to require IBKR live/owner-authorized delayed bid/ask quotes.
"""
from __future__ import annotations

import hashlib
import gzip
import json
import re
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import quote
from pathlib import Path

import httpx

from app.capital import protected_cash_floor, virtual_cash_available
from app.config import settings
from app.database import connection, fetch_all, fetch_one
from app.fx import external_fx_rate

YAHOO_ORIGINS = ("https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com")
PRICE_CACHE_FRESH_SECONDS = 15 * 60
PRICE_CACHE_MAX_AGE_DAYS = 7
PERFORMANCE_REFRESH_SECONDS = 60 * 60
PERFORMANCE_ARCHIVE_DAILY_BYTES = 4096 * 1024
PERFORMANCE_ARCHIVE_HOURLY_BYTES = PERFORMANCE_ARCHIVE_DAILY_BYTES // 24


def _decimal(value: object, default: Decimal = Decimal("0")) -> Decimal:
    try:
        parsed = Decimal(str(value))
        return parsed if parsed.is_finite() else default
    except (InvalidOperation, TypeError, ValueError):
        return default


def _fetch_public_daily_price(symbol: str, now: datetime | None = None) -> dict[str, Any]:
    """Fetch validated daily chart points from either Yahoo chart origin."""
    now = now or datetime.now(UTC)
    symbol = symbol.upper()
    if not re.fullmatch(r"[A-Z0-9.-]{1,15}", symbol):
        raise RuntimeError(f"Unsafe market-data symbol: {symbol!r}")
    period1 = int((now - timedelta(days=14)).timestamp())
    period2 = int((now + timedelta(days=1)).timestamp())
    errors: list[str] = []
    for origin in YAHOO_ORIGINS:
        url = f"{origin}/v8/finance/chart/{quote(symbol.replace('.', '-'), safe='')}"
        try:
            response = httpx.get(
                url,
                params={"period1": period1, "period2": period2, "interval": "1d", "events": "history"},
                headers={"accept": "application/json", "user-agent": "ibkr-codex-paper-performance/1.0"},
                timeout=20,
                follow_redirects=False,
            )
            response.raise_for_status()
            if len(response.content) > 2_000_000:
                raise RuntimeError("response exceeded 2 MB")
            if "json" not in response.headers.get("content-type", "").lower():
                raise RuntimeError("unexpected content type")
            payload = response.json()
            result = payload.get("chart", {}).get("result", [None])[0]
            if not isinstance(result, dict):
                raise RuntimeError("response had no chart result")
            currency = str(result.get("meta", {}).get("currency", "")).upper()
            if currency != "USD":
                raise RuntimeError(f"expected USD data, received {currency or 'unknown currency'}")
            timestamps = result.get("timestamp") or []
            closes = ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
            points: list[tuple[datetime, Decimal]] = []
            for timestamp, close in zip(timestamps, closes, strict=False):
                price = _decimal(close)
                observed = datetime.fromtimestamp(int(timestamp), UTC)
                if price > 0 and observed <= now:
                    points.append((observed, price))
            if not points:
                raise RuntimeError("response had no valid completed price points")
            points.sort(key=lambda item: item[0])
            observed, price = points[-1]
            previous = points[-2][1] if len(points) > 1 else None
            return {
                "symbol": symbol,
                "price": price,
                "previous_close": previous,
                "observed_at": observed,
                "fetched_at": now,
                "source": "Yahoo Finance chart API",
                "response_sha256": hashlib.sha256(response.content).hexdigest(),
                "stale": False,
            }
        except Exception as exc:
            errors.append(f"{origin}: {exc}")
    raise RuntimeError("; ".join(errors))


def _cached_price(symbol: str, *, fresh_only: bool) -> dict[str, Any] | None:
    row = fetch_one("SELECT * FROM market_price_cache WHERE symbol=%s", (symbol.upper(),))
    if not row:
        return None
    if fresh_only and row["fetched_at"] < datetime.now(UTC) - timedelta(seconds=PRICE_CACHE_FRESH_SECONDS):
        return None
    observed = row.get("observed_at") or row.get("fetched_at")
    if observed < datetime.now(UTC) - timedelta(days=PRICE_CACHE_MAX_AGE_DAYS):
        return None
    return {**row, "stale": not fresh_only}


def _price(symbol: str) -> dict[str, Any]:
    cached = _cached_price(symbol, fresh_only=True)
    if cached:
        return cached
    try:
        result = _fetch_public_daily_price(symbol)
        with connection() as conn:
            conn.execute(
                "INSERT INTO market_price_cache(symbol,price,previous_close,observed_at,fetched_at,source,response_sha256) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(symbol) DO UPDATE SET "
                "price=excluded.price,previous_close=excluded.previous_close,observed_at=excluded.observed_at,"
                "fetched_at=excluded.fetched_at,source=excluded.source,response_sha256=excluded.response_sha256",
                (result["symbol"], result["price"], result["previous_close"], result["observed_at"],
                 result["fetched_at"], result["source"], result["response_sha256"]),
            )
            conn.commit()
        return result
    except Exception as exc:
        stale = _cached_price(symbol, fresh_only=False)
        if stale:
            return {**stale, "stale": True, "refresh_error": str(exc)[:500]}
        raise


def calculate_strategy_performance(
    snapshot: dict[str, Any],
    prices: dict[str, dict[str, Any]],
    *,
    initial_budget: Decimal,
    protected_principal: Decimal,
    accrued_baseline: Decimal,
    base_to_usd: Decimal,
    fx_source: str,
    captured_at: datetime | None = None,
) -> dict[str, Any]:
    """Calculate performance without exposing the full broker account value."""
    captured_at = captured_at or datetime.now(UTC)
    base_currency = str(snapshot.get("currency") or "").upper()
    accrued_cash = _decimal(snapshot.get("accrued_cash"))
    protected_floor = protected_cash_floor(protected_principal, accrued_cash, accrued_baseline)
    strategy_cash = virtual_cash_available(_decimal(snapshot.get("total_cash")), protected_floor)
    positions: list[dict[str, Any]] = []
    held_usd = Decimal("0")
    complete = True
    sources: set[str] = set()
    latest_observation: datetime | None = None

    for raw in snapshot.get("positions", []):
        quantity = _decimal(raw.get("quantity"))
        if quantity == 0:
            continue
        symbol = str(raw.get("symbol", "")).upper()
        item: dict[str, Any] = {
            "symbol": symbol,
            "quantity": str(quantity),
            "average_cost_usd": str(_decimal(raw.get("average_cost"))),
        }
        price_row = prices.get(symbol)
        if not price_row:
            complete = False
            item["performance_status"] = "Price unavailable; excluded from totals rather than estimated."
            positions.append(item)
            continue
        price = _decimal(price_row.get("price"))
        previous = _decimal(price_row.get("previous_close"))
        if price <= 0:
            complete = False
            item["performance_status"] = "Invalid price; excluded from totals rather than estimated."
            positions.append(item)
            continue
        market_value_usd = quantity * price
        average_cost = _decimal(raw.get("average_cost"))
        cost_basis_usd = quantity * average_cost
        unrealized_usd = market_value_usd - cost_basis_usd
        total_return_pct = unrealized_usd / cost_basis_usd * 100 if cost_basis_usd else None
        day_change_pct = (price - previous) / previous * 100 if previous > 0 else None
        observed = price_row.get("observed_at")
        if isinstance(observed, str):
            observed = datetime.fromisoformat(observed)
        latest_observation = max(filter(None, (latest_observation, observed)), default=None)
        sources.add(str(price_row.get("source", "Unknown")))
        held_usd += market_value_usd
        item.update({
            "last_usd": str(price),
            "previous_close_usd": str(previous) if previous > 0 else None,
            "market_value_usd": str(market_value_usd),
            "cost_basis_usd": str(cost_basis_usd),
            "unrealized_pnl_usd": str(unrealized_usd),
            "total_return_pct": str(total_return_pct) if total_return_pct is not None else None,
            "latest_day_change_pct": str(day_change_pct) if day_change_pct is not None else None,
            "price_observed_at": observed.isoformat() if isinstance(observed, datetime) else None,
            "price_source": price_row.get("source"),
            "price_stale": bool(price_row.get("stale")),
            "performance_status": "ok",
        })
        positions.append(item)

    if base_to_usd <= 0:
        complete = False
    held_base = held_usd / base_to_usd if base_to_usd > 0 else Decimal("0")
    strategy_value = strategy_cash + held_base if complete else None
    total_return = strategy_value - initial_budget if strategy_value is not None else None
    total_return_pct = total_return / initial_budget * 100 if total_return is not None and initial_budget > 0 else None
    for item in positions:
        market_value = _decimal(item.get("market_value_usd"))
        item["strategy_weight_pct"] = (
            str((market_value / base_to_usd) / strategy_value * 100)
            if strategy_value and market_value else None
        )

    return {
        "available": True,
        "complete": complete,
        "currency": base_currency,
        "initial_budget": str(initial_budget),
        "strategy_value": str(strategy_value) if strategy_value is not None else None,
        "strategy_cash": str(strategy_cash),
        "invested_value": str(held_base) if complete else None,
        "total_return": str(total_return) if total_return is not None else None,
        "total_return_pct": str(total_return_pct) if total_return_pct is not None else None,
        "base_to_usd": str(base_to_usd),
        "fx_source": fx_source,
        "positions": positions,
        "price_sources": sorted(sources),
        "prices_observed_through": latest_observation.isoformat() if latest_observation else None,
        "captured_at": captured_at.isoformat(),
        "scope_note": "Performance is limited to the protected strategy slice; the full IBKR account value is intentionally omitted.",
    }


def _compact_payload(value: dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True, default=str).encode("utf-8")


def _hourly_archive_path(observed_hour: datetime) -> Path:
    observed_hour = observed_hour.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    return (
        settings.artifact_root
        / "performance"
        / observed_hour.strftime("%Y/%m")
        / f"{observed_hour:%Y-%m-%dT%H-00-00Z}.json.gz"
    )


def _write_hourly_archive(observed_hour: datetime, payload: bytes) -> dict[str, Any]:
    """Atomically maintain one timestamped compressed file per UTC hour."""
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)
    path = _hourly_archive_path(observed_hour)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(compressed)
    temporary.replace(path)

    # Remove the superseded one-file-per-day layout after the first successful
    # timestamped write. PostgreSQL remains the canonical history source.
    legacy = path.parent / f"{observed_hour:%Y-%m-%d}.jsonl.gz"
    if legacy.exists():
        legacy.unlink()
    return {
        "path": str(path),
        "uncompressed_bytes": len(payload),
        "compressed_bytes": len(compressed),
    }


def archive_strategy_performance(result: dict[str, Any], captured_at: datetime | None = None) -> dict[str, Any]:
    """Upsert exactly one complete performance record per UTC hour."""
    captured_at = captured_at or datetime.now(UTC)
    observed_hour = captured_at.replace(minute=0, second=0, microsecond=0)
    record = {
        "observed_hour": observed_hour.isoformat(),
        "captured_at": captured_at.isoformat(),
        "performance": result,
    }
    payload = _compact_payload(record)
    if len(payload) > PERFORMANCE_ARCHIVE_HOURLY_BYTES:
        raise RuntimeError(
            f"Hourly performance record is {len(payload)} bytes; the limit is {PERFORMANCE_ARCHIVE_HOURLY_BYTES}."
        )
    day_start = observed_hour.replace(hour=0)
    with connection() as conn:
        daily = conn.execute(
            "SELECT COALESCE(sum(payload_bytes),0) AS payload_bytes FROM portfolio_performance_history "
            "WHERE observed_hour >= %s AND observed_hour < %s AND observed_hour <> %s",
            (day_start, day_start + timedelta(days=1), observed_hour),
        ).fetchone()
        daily_bytes = int(daily["payload_bytes"] if daily else 0) + len(payload)
        if daily_bytes > PERFORMANCE_ARCHIVE_DAILY_BYTES:
            raise RuntimeError(
                f"Daily performance records would exceed {PERFORMANCE_ARCHIVE_DAILY_BYTES} bytes; nothing was written."
            )
        conn.execute(
            "INSERT INTO portfolio_performance_history(observed_hour,captured_at,snapshot,payload_bytes) "
            "VALUES(%s,%s,%s::jsonb,%s) ON CONFLICT(observed_hour) DO UPDATE SET "
            "captured_at=excluded.captured_at,snapshot=excluded.snapshot,payload_bytes=excluded.payload_bytes",
            (observed_hour, captured_at, json.dumps(result, separators=(",", ":"), default=str), len(payload)),
        )
        conn.commit()
    return _write_hourly_archive(observed_hour, payload)


def refresh_strategy_performance() -> dict[str, Any]:
    cached = fetch_one("SELECT snapshot,captured_at FROM portfolio_cache WHERE singleton=true")
    if not cached:
        raise RuntimeError("No saved IBKR portfolio is available for strategy performance.")
    snapshot = dict(cached["snapshot"])
    positions = [item for item in snapshot.get("positions", []) if _decimal(item.get("quantity")) != 0]
    price_rows: dict[str, dict[str, Any]] = {}
    errors: dict[str, str] = {}
    for position in positions:
        symbol = str(position.get("symbol", "")).upper()
        try:
            price_rows[symbol] = _price(symbol)
        except Exception as exc:
            errors[symbol] = str(exc)[:500]

    settings_rows = {
        row["key"]: row["value"] for row in fetch_all(
            "SELECT key,value FROM app_settings WHERE key IN "
            "('virtual_investable_capital','virtual_cash_reserve_principal','virtual_cash_reserve_accrued_baseline')"
        )
    }
    required = {
        "virtual_investable_capital", "virtual_cash_reserve_principal", "virtual_cash_reserve_accrued_baseline"
    }
    if required - set(settings_rows):
        raise RuntimeError("Virtual-capital settings are incomplete; performance cannot be calculated safely.")
    base_currency = str(snapshot.get("currency", "")).upper()
    fx = external_fx_rate(base_currency)
    result = calculate_strategy_performance(
        snapshot,
        price_rows,
        initial_budget=_decimal(settings_rows["virtual_investable_capital"]),
        protected_principal=_decimal(settings_rows["virtual_cash_reserve_principal"]),
        accrued_baseline=_decimal(settings_rows["virtual_cash_reserve_accrued_baseline"]),
        base_to_usd=fx.rate,
        fx_source=fx.source,
    )
    result["price_errors"] = errors
    with connection() as conn:
        conn.execute(
            "INSERT INTO portfolio_performance(singleton,snapshot,captured_at) VALUES(true,%s::jsonb,now()) "
            "ON CONFLICT(singleton) DO UPDATE SET snapshot=excluded.snapshot,captured_at=excluded.captured_at",
            (json.dumps(result, default=str),),
        )
        conn.commit()
    result["archive"] = archive_strategy_performance(result)
    return result


def latest_strategy_performance() -> dict[str, Any]:
    row = fetch_one("SELECT snapshot,captured_at FROM portfolio_performance WHERE singleton=true")
    if not row:
        return {
            "available": False,
            "scope_note": "Strategy-slice performance has not been calculated yet; the full account value is hidden.",
        }
    return {**row["snapshot"], "captured_at": row["captured_at"].isoformat()}


def strategy_performance_history(limit: int = 24) -> dict[str, Any]:
    rows = fetch_all(
        "SELECT observed_hour,captured_at,snapshot,payload_bytes FROM portfolio_performance_history "
        "ORDER BY observed_hour DESC LIMIT %s",
        (limit,),
    )
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    daily = fetch_one(
        "SELECT count(*) AS snapshots,COALESCE(sum(payload_bytes),0) AS payload_bytes "
        "FROM portfolio_performance_history WHERE observed_hour >= %s AND observed_hour < %s",
        (today, today + timedelta(days=1)),
    ) or {"snapshots": 0, "payload_bytes": 0}
    return {
        "frequency": "hourly",
        "hourly_budget_bytes": PERFORMANCE_ARCHIVE_HOURLY_BYTES,
        "daily_budget_bytes": PERFORMANCE_ARCHIVE_DAILY_BYTES,
        "today_snapshots": int(daily["snapshots"]),
        "today_payload_bytes": int(daily["payload_bytes"]),
        "items": [
            {
                "observed_hour": row["observed_hour"].isoformat(),
                "captured_at": row["captured_at"].isoformat(),
                "archive_file": _hourly_archive_path(row["observed_hour"]).name,
                "payload_bytes": row["payload_bytes"],
                "performance": row["snapshot"],
            }
            for row in rows
        ],
    }
