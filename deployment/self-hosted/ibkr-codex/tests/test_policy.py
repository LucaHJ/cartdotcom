from decimal import Decimal

import pytest

from app.policy import POLICY, PolicyViolation, proposed_order


def decision(action: str, target: str) -> dict:
    return {
        "symbol": "SPY",
        "action": action,
        "target_weight_pct": target,
        "confidence": 0.8,
        "thesis": "test",
        "citations": ["https://www.sec.gov/"],
    }


def test_hold_never_creates_an_order() -> None:
    result = proposed_order(
        decision=decision("HOLD", "5"), net_liquidation=Decimal("100000"), cash=Decimal("50000"),
        current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("500"),
        ask=Decimal("500.10"), turnover_used=Decimal("0"),
    )
    assert result is None


def test_buy_is_whole_share_and_capped_at_five_percent() -> None:
    result = proposed_order(
        decision=decision("BUY", "15"), net_liquidation=Decimal("100000"), cash=Decimal("50000"),
        current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("99.90"),
        ask=Decimal("100"), turnover_used=Decimal("0"),
    )
    assert result is not None
    assert result["quantity"] == result["quantity"].to_integral_value()
    assert result["estimated_notional"] <= Decimal("5000")


def test_sell_can_never_exceed_long_holding() -> None:
    result = proposed_order(
        decision=decision("SELL", "0"), net_liquidation=Decimal("100000"), cash=Decimal("5000"),
        current_quantity=Decimal("7"), current_market_value=Decimal("700"), bid=Decimal("99.90"),
        ask=Decimal("100"), turnover_used=Decimal("0"),
    )
    assert result is not None
    assert result["quantity"] <= Decimal("7")


def test_penny_stock_and_wide_spread_are_rejected() -> None:
    with pytest.raises(PolicyViolation, match="below"):
        proposed_order(
            decision=decision("BUY", "5"), net_liquidation=Decimal("100000"), cash=Decimal("50000"),
            current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("3.90"),
            ask=Decimal("4"), turnover_used=Decimal("0"),
        )
    with pytest.raises(PolicyViolation, match="spread"):
        proposed_order(
            decision=decision("BUY", "5"), net_liquidation=Decimal("100000"), cash=Decimal("50000"),
            current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("98"),
            ask=Decimal("100"), turnover_used=Decimal("0"),
        )


def test_policy_defaults_match_the_published_limits() -> None:
    assert POLICY.max_new_position_pct == Decimal("5")
    assert POLICY.max_total_position_pct == Decimal("15")
    assert POLICY.max_turnover_pct == Decimal("20")
    assert POLICY.min_cash_reserve_pct == Decimal("5")
    assert POLICY.max_orders_per_run == 5
    assert POLICY.max_attempts == 3


def test_buy_reserves_cash_at_the_maximum_permitted_reprice() -> None:
    result = proposed_order(
        decision=decision("BUY", "5"), net_liquidation=Decimal("100000"), cash=Decimal("6000"),
        current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("99.90"),
        ask=Decimal("100"), turnover_used=Decimal("0"),
    )
    assert result is not None
    worst_fill = result["quantity"] * Decimal("100") * (Decimal("1") + POLICY.max_slippage_pct / 100)
    assert Decimal("6000") - worst_fill >= Decimal("5000")
