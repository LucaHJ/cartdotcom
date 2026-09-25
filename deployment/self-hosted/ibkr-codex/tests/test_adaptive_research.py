import copy
from decimal import Decimal as D
import pytest
from app.allocation import validate_plan, validate_target_actions, execution_policy, industry_room, LEGACY_POLICY
from app.policy import proposed_order, PolicyViolation
from app.research_protocol import stages, UNIVERSE, validate_stage, validate_research_output
from research_samples import stage_result, full_output, plan


def test_all_nine_work_products_are_required():
    assert len(stages()) == 9
    assert len(set(sum(UNIVERSE.values(), []))) == 36
    output = full_output()
    validate_research_output(output, [])
    output["research_dossier"]["stages"].pop(2)
    with pytest.raises(ValueError, match="Missing required stage"):
        validate_research_output(output, [])


@pytest.mark.parametrize("mutation", ["missing_industry", "missing_future", "one_source", "missing_field"])
def test_incomplete_screen_is_not_accepted(mutation):
    r = stage_result("screen_compute")
    if mutation == "missing_industry": r["industries"][0]["industry"] = "WRONG"
    if mutation == "missing_future": r["industries"][0]["events"][2]["timing"] = "past"
    if mutation == "one_source": r["industries"][0]["citations"].pop()
    if mutation == "missing_field": del r["industries"][0]["bear_case"]
    with pytest.raises(ValueError):
        validate_stage("screen_compute", r, UNIVERSE["compute"])


def test_uncapped_full_investment_is_allowed_without_changing_capital():
    r = stage_result("allocation")
    r["decisions"][0]["target_weight_pct"] = 100
    p = plan(r["decisions"])
    validate_plan(p, r["decisions"], [])
    policy = execution_policy(p, "SPY")
    assert policy.max_turnover_pct is None and policy.min_cash_reserve_pct == 0
    order = proposed_order(decision=r["decisions"][0], net_liquidation=D(20000), cash=D(20000),
        current_quantity=D(0), current_market_value=D(0), asset_class_value=D(0),
        bid=D(100), ask=D(100), turnover_used=D(50000), allocation_policy=policy)
    assert D(19000) < order["estimated_notional"] <= D(20000)
    assert execution_policy(None, "SPY") == LEGACY_POLICY


@pytest.mark.parametrize("mutation", ["sum", "industry_sum", "cap", "nan", "authority", "omitted_holding", "mismatch", "new_cap"])
def test_bad_allocation_is_rejected(mutation):
    r = stage_result("allocation"); p = r["allocation_plan"]; holdings = []
    if mutation == "sum": p["cash_target_pct"] = 0
    if mutation == "industry_sum": p["industries"][0]["target_weight_pct"] = 10
    if mutation == "cap": p["position_cap_pct"] = 1
    if mutation == "nan": p["turnover_cap_pct"] = float("nan")
    if mutation == "authority": p["strategy_capital"] = 1000000
    if mutation == "omitted_holding": holdings = [{"symbol": "OLD", "quantity": 5}]
    if mutation == "mismatch": r["decisions"][0]["allocation_bucket"] = "OTHER"
    if mutation == "new_cap": p["new_position_cap_pct"] = 1
    with pytest.raises(PolicyViolation): validate_plan(p, r["decisions"], holdings)


def test_new_position_cap_does_not_reclassify_existing_holdings():
    r = stage_result("allocation"); p = r["allocation_plan"]; p["new_position_cap_pct"] = 1
    validate_plan(p, r["decisions"], [{"symbol": "SPY", "quantity": 1}])


def test_agent_selected_industry_and_cash_caps_are_enforced():
    r = stage_result("allocation"); p = r["allocation_plan"]
    p["industries"][0]["max_weight_pct"] = 5
    room = industry_room(p, "SPY", {"positions": [{"symbol": "SPY", "market_value": "800"}]}, D(20000))
    assert room == 200
    policy = execution_policy(p, "SPY")
    order = proposed_order(decision=r["decisions"][0], net_liquidation=D(20000), cash=D(20000),
        current_quantity=D(8), current_market_value=D(800), asset_class_value=D(800), bid=D(100), ask=D(100),
        turnover_used=D(0), allocation_policy=policy, industry_available=room)
    assert order["estimated_notional"] <= 200


def test_hold_cannot_disguise_reallocation_and_direction_must_agree():
    r = stage_result("allocation")
    perf = {"complete": True, "positions": [{"symbol": "SPY", "strategy_weight_pct": 10}]}
    for action in ("HOLD", "BUY"):
        r["decisions"][0]["action"] = action
        with pytest.raises(PolicyViolation): validate_target_actions(r["allocation_plan"], r["decisions"], perf)
    r["decisions"][0]["action"] = "SELL"
    validate_target_actions(r["allocation_plan"], r["decisions"], perf)
    r["allocation_plan"]["turnover_cap_pct"] = 1
    with pytest.raises(PolicyViolation, match="turnover"):
        validate_target_actions(r["allocation_plan"], r["decisions"], perf)
