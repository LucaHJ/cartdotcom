from decimal import Decimal

import pytest

from app.policy import POLICY, PolicyViolation, proposed_order, validate_decision_shape
from app.allocation import LEGACY_POLICY


def decision(action: str, target: str) -> dict:
    return {
        "symbol": "SPY",
        "asset_type": "US_EQUITY",
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
        ask=Decimal("500.10"), asset_class_value=Decimal("0"), turnover_used=Decimal("0"),
    )
    assert result is None


def test_buy_is_whole_share_and_not_capped_at_five_percent() -> None:
    result = proposed_order(
        decision=decision("BUY", "15"), net_liquidation=Decimal("100000"), cash=Decimal("50000"),
        current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("99.90"),
        ask=Decimal("100"), asset_class_value=Decimal("0"), turnover_used=Decimal("0"),
    )
    assert result is not None
    assert result["quantity"] == result["quantity"].to_integral_value()
    assert Decimal("14000") < result["estimated_notional"] <= Decimal("15000")


def test_sell_can_never_exceed_long_holding() -> None:
    result = proposed_order(
        decision=decision("SELL", "0"), net_liquidation=Decimal("100000"), cash=Decimal("5000"),
        current_quantity=Decimal("7"), current_market_value=Decimal("700"), bid=Decimal("99.90"),
        ask=Decimal("100"), asset_class_value=Decimal("700"), turnover_used=Decimal("0"),
    )
    assert result is not None
    assert result["quantity"] <= Decimal("7")


def test_penny_stock_and_wide_spread_are_rejected() -> None:
    with pytest.raises(PolicyViolation, match="below"):
        proposed_order(
            decision=decision("BUY", "5"), net_liquidation=Decimal("100000"), cash=Decimal("50000"),
            current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("3.90"),
            ask=Decimal("4"), asset_class_value=Decimal("0"), turnover_used=Decimal("0"),
        )
    with pytest.raises(PolicyViolation, match="spread"):
        proposed_order(
            decision=decision("BUY", "5"), net_liquidation=Decimal("100000"), cash=Decimal("50000"),
            current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("98"),
            ask=Decimal("100"), asset_class_value=Decimal("0"), turnover_used=Decimal("0"),
        )


def test_policy_defaults_match_the_published_limits() -> None:
    assert POLICY.public()["max_new_position_pct"] is None
    assert POLICY.public()["max_total_position_pct"] is None
    assert POLICY.max_turnover_pct is None
    assert POLICY.min_cash_reserve_pct == Decimal("0")
    assert POLICY.max_orders_per_run == 10
    assert POLICY.max_attempts == 3


def test_standing_allocation_targets_are_complete() -> None:
    targets = POLICY.allocation_targets()
    assert targets == {}


def test_buy_reserves_cash_at_the_maximum_permitted_reprice() -> None:
    result = proposed_order(
        allocation_policy=LEGACY_POLICY,
        decision=decision("BUY", "5"), net_liquidation=Decimal("100000"), cash=Decimal("6000"),
        current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("99.90"),
        ask=Decimal("100"), asset_class_value=Decimal("0"), turnover_used=Decimal("0"),
    )
    assert result is not None
    worst_fill = result["quantity"] * Decimal("100") * (Decimal("1") + POLICY.max_slippage_pct / 100)
    assert Decimal("6000") - worst_fill >= Decimal("5000")


@pytest.mark.parametrize("symbol", ["SPY", "MSFT"])
def test_large_stock_or_etf_target_obeys_only_remaining_run_turnover(symbol) -> None:
    recommendation = decision("BUY", "60")
    recommendation["symbol"] = symbol
    result = proposed_order(
        allocation_policy=LEGACY_POLICY,
        decision=recommendation, net_liquidation=Decimal("100000"), cash=Decimal("80000"),
        current_quantity=Decimal("200"), current_market_value=Decimal("20000"), bid=Decimal("99.90"),
        ask=Decimal("100"), asset_class_value=Decimal("20000"), turnover_used=Decimal("1000"),
    )
    assert result is not None
    assert Decimal("18000") < result["estimated_notional"] <= Decimal("19000")
    assert Decimal("20000") + result["estimated_notional"] > Decimal("15000")


def test_sell_can_retain_more_than_former_position_cap() -> None:
    result = proposed_order(
        decision=decision("SELL", "40"), net_liquidation=Decimal("100000"), cash=Decimal("50000"),
        current_quantity=Decimal("500"), current_market_value=Decimal("50000"), bid=Decimal("100"),
        ask=Decimal("100"), asset_class_value=Decimal("50000"), turnover_used=Decimal("0"),
    )
    assert result is not None
    assert result["quantity"] == Decimal("100")


def test_unrestricted_target_still_preserves_overall_equity_allocation() -> None:
    result = proposed_order(
        allocation_policy=LEGACY_POLICY,
        decision=decision("BUY", "100"), net_liquidation=Decimal("100000"), cash=Decimal("50000"),
        current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("100"),
        ask=Decimal("100"), asset_class_value=Decimal("94000"), turnover_used=Decimal("0"),
    )
    assert result is not None
    assert result["estimated_notional"] <= Decimal("1000")


@pytest.mark.parametrize("target", ["-1", "101", "NaN", "Infinity", "bad"])
def test_invalid_weights_remain_rejected(target) -> None:
    with pytest.raises(PolicyViolation):
        validate_decision_shape(decision("BUY", target))


@pytest.mark.parametrize("action", ["BUY", "SELL", "HOLD"])
def test_high_target_weights_are_valid_for_all_actions(action) -> None:
    validate_decision_shape(decision(action, "95"))


def test_large_buy_cannot_spend_reserved_cash() -> None:
    result = proposed_order(
        allocation_policy=LEGACY_POLICY,
        decision=decision("BUY", "95"), net_liquidation=Decimal("100000"), cash=Decimal("6000"),
        current_quantity=Decimal("0"), current_market_value=Decimal("0"), bid=Decimal("100"),
        ask=Decimal("100"), asset_class_value=Decimal("94000"), turnover_used=Decimal("0"),
    )
    assert result is not None
    assert Decimal("6000") - result["estimated_notional"] >= Decimal("5000")
