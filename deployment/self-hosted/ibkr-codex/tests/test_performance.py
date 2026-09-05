import gzip
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from app import performance
from app.performance import PERFORMANCE_ARCHIVE_DAILY_BYTES, PERFORMANCE_ARCHIVE_HOURLY_BYTES, calculate_strategy_performance


def _snapshot() -> dict[str, object]:
    return {
        "account_id": "DU123",
        "currency": "USD",
        "net_liquidation": "1000000",
        "total_cash": "988000",
        "accrued_cash": "0",
        "positions": [{
            "symbol": "SCHB", "sec_type": "STK", "currency": "USD",
            "quantity": "100", "average_cost": "100",
        }],
    }


def test_performance_uses_only_twenty_thousand_strategy_slice() -> None:
    observed = datetime(2026, 9, 4, 20, 0, tzinfo=UTC)
    result = calculate_strategy_performance(
        _snapshot(),
        {"SCHB": {"price": "120", "previous_close": "118", "observed_at": observed,
                  "source": "public-test", "stale": False}},
        initial_budget=Decimal("20000"), protected_principal=Decimal("980000"),
        accrued_baseline=Decimal("0"), base_to_usd=Decimal("1"), fx_source="identity",
        captured_at=observed + timedelta(minutes=1),
    )

    assert result["strategy_cash"] == "8000"
    assert result["invested_value"] == "12000"
    assert result["strategy_value"] == "20000"
    assert result["total_return_pct"] == "0"
    assert result["positions"][0]["total_return_pct"] == "20.0"
    assert result["positions"][0]["strategy_weight_pct"] == "60.0"
    assert "net_liquidation" not in result
    assert "total_cash" not in result


def test_missing_price_makes_totals_explicitly_incomplete() -> None:
    result = calculate_strategy_performance(
        _snapshot(), {}, initial_budget=Decimal("20000"),
        protected_principal=Decimal("980000"), accrued_baseline=Decimal("0"),
        base_to_usd=Decimal("1"), fx_source="identity",
    )

    assert result["complete"] is False
    assert result["strategy_value"] is None
    assert result["total_return_pct"] is None
    assert "excluded from totals" in result["positions"][0]["performance_status"]


def test_daily_archive_is_one_compact_deterministic_file(tmp_path) -> None:
    hour = datetime(2026, 9, 5, 1, tzinfo=UTC)
    rows = [
        {"observed_hour": hour, "captured_at": hour + timedelta(minutes=2),
         "snapshot": {"strategy_value": "20001", "positions": [{"symbol": "SCHB", "market_value_usd": "1000"}]},
         "payload_bytes": 100},
        {"observed_hour": hour + timedelta(hours=1), "captured_at": hour + timedelta(hours=1, minutes=2),
         "snapshot": {"strategy_value": "20002", "positions": [{"symbol": "SCHB", "market_value_usd": "1001"}]},
         "payload_bytes": 100},
    ]
    with (
        patch.object(performance, "settings", SimpleNamespace(artifact_root=tmp_path)),
        patch.object(performance, "fetch_all", return_value=rows),
    ):
        result = performance._rewrite_daily_archive(hour)
        second = performance._rewrite_daily_archive(hour)

    files = list(tmp_path.rglob("*.jsonl.gz"))
    assert len(files) == 1
    assert result["path"] == second["path"]
    payload = gzip.decompress(files[0].read_bytes())
    assert len(payload) <= PERFORMANCE_ARCHIVE_DAILY_BYTES
    records = [json.loads(line) for line in payload.splitlines()]
    assert [item["performance"]["strategy_value"] for item in records] == ["20001", "20002"]
    assert PERFORMANCE_ARCHIVE_HOURLY_BYTES == 174761
