"""Immutable, run-scoped allocation authority. Never changes the paper boundary."""
from dataclasses import replace
from decimal import Decimal, InvalidOperation
import re

from app.policy import POLICY, RiskPolicy, PolicyViolation


LEGACY_POLICY = replace(POLICY, min_cash_reserve_pct=Decimal("5"), max_turnover_pct=Decimal("20"))


def percentage(value, name, nullable=False, maximum=100):
    if value is None and nullable:
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise PolicyViolation(f"Invalid {name}.") from None
    if not result.is_finite() or not 0 <= result <= maximum:
        raise PolicyViolation(f"{name} must be finite and between 0 and {maximum}.")
    return result


def validate_plan(plan, decisions, holdings=None):
    if not isinstance(plan, dict):
        raise PolicyViolation("A complete allocation plan is required.")
    required = {"cash_target_pct", "new_position_cap_pct", "position_cap_pct", "turnover_cap_pct",
                "industries", "positions", "rationale"}
    if set(plan) != required:
        raise PolicyViolation("Allocation plan fields do not match the permitted allocation authority.")
    cash = percentage(plan["cash_target_pct"], "cash target")
    new_cap = percentage(plan["new_position_cap_pct"], "new-position cap", True)
    position_cap = percentage(plan["position_cap_pct"], "position cap", True)
    percentage(plan["turnover_cap_pct"], "turnover cap", True, maximum=200)
    if not isinstance(plan["rationale"], str) or len(plan["rationale"].strip()) < 40:
        raise PolicyViolation("Allocation rationale is required.")
    industries, positions = {}, {}
    for item in plan["industries"]:
        name = item["industry"]
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,63}", name) or name in industries:
            raise PolicyViolation("Industries must be unique safe identifiers.")
        target = percentage(item["target_weight_pct"], "industry target")
        cap = percentage(item["max_weight_pct"], "industry cap", True)
        if cap is not None and target > cap:
            raise PolicyViolation("Industry target exceeds its chosen cap.")
        industries[name] = (target, cap)
    for item in plan["positions"]:
        symbol = item["symbol"]
        if not re.fullmatch(r"[A-Z0-9.-]{1,12}", symbol) or symbol in positions:
            raise PolicyViolation("Position symbols must be unique.")
        target = percentage(item["target_weight_pct"], "position target")
        cap = percentage(item["max_weight_pct"], "individual position cap", True)
        if item["industry"] not in industries:
            raise PolicyViolation("Every holding needs a declared industry bucket.")
        if any(target > limit for limit in (cap, position_cap) if limit is not None):
            raise PolicyViolation("Position target exceeds its chosen cap.")
        positions[symbol] = item
    if abs(sum((percentage(p["target_weight_pct"], "weight") for p in positions.values()), cash) - 100) > Decimal("0.02"):
        raise PolicyViolation("Full portfolio targets plus cash must sum to 100%.")
    for industry, (target, _) in industries.items():
        actual = sum((percentage(p["target_weight_pct"], "weight") for p in positions.values()
                      if p["industry"] == industry), Decimal(0))
        if abs(actual - target) > Decimal("0.02"):
            raise PolicyViolation(f"Industry {industry} target {target}% differs from its positions total {actual}%. "
                                  "Cash belongs ONLY in cash_target_pct, never an industry or security position. "
                                  "Industry targets must equal their constituent position targets.")
    for holding in holdings or ():
        if Decimal(str(holding.get("quantity", 0))) and holding["symbol"] not in positions:
            raise PolicyViolation("Allocation plan omitted an existing holding (include exits at zero).")
    seen = set()
    for decision in decisions:
        symbol = decision["symbol"]
        if symbol in seen or symbol not in positions:
            raise PolicyViolation("Decision symbols must be unique and present in the plan.")
        seen.add(symbol)
        item = positions[symbol]
        if holdings is not None:
            held = any(p["symbol"] == symbol and Decimal(str(p.get("quantity", 0))) > 0 for p in holdings)
            if not held and decision["action"] in {"SELL", "HOLD"} and percentage(item["target_weight_pct"], "target") > 0:
                raise PolicyViolation("An unheld positive target requires a BUY, not SELL or HOLD.")
        if decision["allocation_bucket"] != item["industry"] or percentage(decision["target_weight_pct"], "target") != percentage(item["target_weight_pct"], "target"):
            raise PolicyViolation("Decision and immutable allocation plan disagree.")
        if holdings is not None and new_cap is not None and symbol not in {p["symbol"] for p in holdings if Decimal(str(p.get("quantity", 0)))} and decision["action"] == "BUY" and percentage(item["target_weight_pct"], "target") > new_cap:
            raise PolicyViolation("New holding target exceeds its chosen cap.")
    if set(positions) != seen:
        raise PolicyViolation("Every planned holding needs an explicit BUY, SELL or HOLD decision.")
    return plan


def validate_target_actions(plan, decisions, performance):
    """Reject concealed rebalances when a complete strategy mark is available."""
    if not performance or not performance.get("complete"):
        return
    weights = {p["symbol"]: percentage(p["strategy_weight_pct"], "observed weight")
               for p in performance.get("positions", []) if p.get("strategy_weight_pct") is not None}
    # Allow rounding/noise between the independently marked inputs and targets.
    tolerance = Decimal("0.5")
    turnover = Decimal(0)
    for decision in decisions:
        current = weights.get(decision["symbol"], Decimal(0))
        change = percentage(decision["target_weight_pct"], "target") - current
        action = decision["action"]
        if action == "HOLD" and abs(change) > tolerance:
            raise PolicyViolation("HOLD cannot conceal a material change in target weight.")
        if action == "BUY" and change < -tolerance or action == "SELL" and change > tolerance:
            raise PolicyViolation("Trade direction disagrees with the saved strategy weight.")
        if action != "HOLD":
            turnover += abs(change)
    cap = percentage(plan["turnover_cap_pct"], "turnover", True, 200)
    if cap is not None and turnover > cap + tolerance * len(decisions):
        raise PolicyViolation("Proposed rotation exceeds its own gross turnover budget.")


def execution_policy(plan, symbol):
    if plan is None:
        return LEGACY_POLICY
    item = next(p for p in plan["positions"] if p["symbol"] == symbol)
    caps = [percentage(v, "position cap", True) for v in (plan["position_cap_pct"], item["max_weight_pct"])]
    return replace(POLICY, min_cash_reserve_pct=percentage(plan["cash_target_pct"], "cash"),
                   max_total_position_pct=min((v for v in caps if v is not None), default=None),
                   max_new_position_pct=percentage(plan["new_position_cap_pct"], "new cap", True),
                   max_turnover_pct=percentage(plan["turnover_cap_pct"], "turnover", True, 200))


def industry_room(plan, symbol, snapshot, nav):
    if plan is None:
        return None
    mapping = {p["symbol"]: p["industry"] for p in plan["positions"]}
    industry = mapping[symbol]
    cap = next(p["max_weight_pct"] for p in plan["industries"] if p["industry"] == industry)
    if cap is None:
        return None
    used = sum((Decimal(str(p.get("market_value", 0))) for p in snapshot["positions"]
                if mapping.get(p["symbol"]) == industry), Decimal(0))
    return max(Decimal(0), nav * percentage(cap, "industry cap") / 100 - used)
