from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.fx import ExternalFxRate, _parse_ecb_cross
from app import workflow


def ecb_payload(observed: date, aud: str = "1.50", usd: str = "1.08") -> bytes:
    return ("CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\n"
            f"AUD,EUR,{observed.isoformat()},{aud}\n"
            f"USD,EUR,{observed.isoformat()},{usd}\n").encode()


def test_ecb_cross_uses_matching_current_observations() -> None:
    observed = datetime.now(UTC).date()
    rate, rate_date = _parse_ecb_cross(ecb_payload(observed), "AUD", "USD")
    assert rate == Decimal("0.72")
    assert rate_date == observed


def test_ecb_cross_rejects_stale_and_mismatched_data() -> None:
    old = datetime.now(UTC).date() - timedelta(days=10)
    with pytest.raises(RuntimeError, match="age"):
        _parse_ecb_cross(ecb_payload(old), "AUD", "USD")
    observed = datetime.now(UTC).date()
    mismatched = ("CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\n"
                  f"AUD,EUR,{observed.isoformat()},1.50\n"
                  f"USD,EUR,{(observed - timedelta(days=1)).isoformat()},1.08\n").encode()
    with pytest.raises(RuntimeError, match="matching"):
        _parse_ecb_cross(mismatched, "AUD", "USD")


def test_virtual_capital_uses_haircut_external_fx_when_ibkr_denies_fx() -> None:
    broker = SimpleNamespace(
        resolve_base_to_usd_fx=lambda currency: (_ for _ in ()).throw(RuntimeError("permission denied")),
    )
    snapshot = {"currency": "AUD", "total_cash": "1000000", "accrued_cash": "0", "positions": []}
    settings_rows = {
        "virtual_cash_reserve_currency": "AUD",
        "virtual_cash_reserve_principal": "980000",
        "virtual_cash_reserve_accrued_baseline": "0",
    }
    external = ExternalFxRate("AUD", "USD", Decimal("0.72"), date.today(), datetime.now(UTC),
                              "ECB reference rate", "abc123")

    def fake_fetch(sql, params=()):
        key = params[0] if params else "virtual_cash_reserve_currency"
        return {"value": settings_rows[key]}

    with patch.object(workflow, "fetch_one", side_effect=fake_fetch), patch.object(workflow, "external_fx_rate", return_value=external):
        capital = workflow._virtual_capital_context(broker, snapshot)
    assert capital["base_to_usd"] == Decimal("0.7056")
    assert capital["cash_usd"] == Decimal("14112.0000")
    assert capital["fx_details"]["fallback"] is True
    assert capital["fx_details"]["response_sha256"] == "abc123"


