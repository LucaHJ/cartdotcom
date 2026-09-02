from decimal import Decimal

import pytest

from app.policy import POLICY, PolicyViolation, proposed_order


def crypto_decision(target: str = "5") -> dict:
    return {
        "symbol": "BTC",
        "asset_type": "CRYPTO",
        "action": "BUY",
        "target_weight_pct": target,
        "confidence": 0.8,
        "thesis": "test",
        "citations": ["https://www.sec.gov/"],
    }


def test_crypto_is_a_separate_capped_fractional_allocation() -> None:
    result = proposed_order(
        decision=crypto_decision(), net_liquidation=Decimal("100000"), cash=Decimal("100000"),
        current_quantity=Decimal("0"), current_market_value=Decimal("0"),
        asset_class_value=Decimal("0"), bid=Decimal("99900"), ask=Decimal("100000"), turnover_used=Decimal("0"),
    )
    assert result is not None
    assert result["asset_type"] == "CRYPTO"
    assert result["quantity"] % Decimal("0.0001") == 0
    assert result["estimated_notional"] <= Decimal("3000")


def test_crypto_cannot_exceed_portfolio_or_single_asset_cap() -> None:
    with pytest.raises(PolicyViolation, match="CRYPTO position cap"):
        proposed_order(
            decision=crypto_decision("5.1"), net_liquidation=Decimal("100000"), cash=Decimal("100000"),
            current_quantity=Decimal("0"), current_market_value=Decimal("0"),
            asset_class_value=Decimal("0"), bid=Decimal("99900"), ask=Decimal("100000"), turnover_used=Decimal("0"),
        )
    assert POLICY.crypto_target_allocation_pct == Decimal("10")
    assert POLICY.max_crypto_allocation_pct == Decimal("10")
