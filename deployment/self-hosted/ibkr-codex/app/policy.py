from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from decimal import Decimal, ROUND_DOWN
from typing import Any


@dataclass(frozen=True)
class RiskPolicy:
    max_new_position_pct: Decimal = Decimal("5")
    max_total_position_pct: Decimal = Decimal("15")
    equity_target_allocation_pct: Decimal = Decimal("95")
    international_equity_target_pct: Decimal = Decimal("25")
    power_and_grid_target_pct: Decimal = Decimal("15")
    domestic_diversified_target_pct: Decimal = Decimal("55")
    max_turnover_pct: Decimal = Decimal("20")
    min_cash_reserve_pct: Decimal = Decimal("5")
    max_orders_per_run: int = 10
    min_share_price: Decimal = Decimal("5")
    max_spread_pct: Decimal = Decimal("1")
    initial_slippage_pct: Decimal = Decimal("0.20")
    max_slippage_pct: Decimal = Decimal("0.75")
    max_attempts: int = 3
    attempt_seconds: int = 300
    allowed_security_types: tuple[str, ...] = ("STK",)
    allowed_currencies: tuple[str, ...] = ("USD",)
    fractional_shares: bool = False
    shorting: bool = False
    margin: bool = False

    def allocation_targets(self) -> dict[str, Decimal]:
        """Strategic paper allocations, deliberately leaving a cash buffer."""
        return {
            "DOMESTIC_DIVERSIFIED": self.domestic_diversified_target_pct,
            "INTERNATIONAL_EQUITY": self.international_equity_target_pct,
            "POWER_AND_GRID": self.power_and_grid_target_pct,
            "CASH_RESERVE": self.min_cash_reserve_pct,
        }

    def public(self) -> dict[str, Any]:
        result = asdict(self)
        result["allocation_targets_pct"] = self.allocation_targets()
        return {
            key: (
                {nested_key: float(nested_value) for nested_key, nested_value in value.items()}
                if isinstance(value, dict)
                else float(value) if isinstance(value, Decimal) else value
            )
            for key, value in result.items()
        }


POLICY = RiskPolicy()


class PolicyViolation(ValueError):
    pass


def whole_shares(value: Decimal) -> Decimal:
    return value.quantize(Decimal("1"), rounding=ROUND_DOWN)


def asset_type_for_security_type(security_type: str) -> str:
    if security_type.upper() != "STK":
        raise PolicyViolation("Only US-listed stocks and ordinary unleveraged ETFs are permitted.")
    return "US_EQUITY"


def quantity_for_asset_type(value: Decimal, asset_type: str) -> Decimal:
    return whole_shares(value)


def validate_decision_shape(decision: dict[str, Any]) -> None:
    symbol = str(decision.get("symbol", "")).strip().upper()
    action = str(decision.get("action", "")).upper()
    asset_type = str(decision.get("asset_type", "")).upper()
    allocation_bucket = str(decision.get("allocation_bucket", "DOMESTIC_DIVERSIFIED")).upper()
    if not symbol or len(symbol) > 12 or not all(c.isalnum() or c in ".-" for c in symbol):
        raise PolicyViolation("Invalid ticker symbol.")
    if action not in {"BUY", "SELL", "HOLD"}:
        raise PolicyViolation("Action must be BUY, SELL, or HOLD.")
    if asset_type != "US_EQUITY":
        raise PolicyViolation("Crypto and all non-US-equity asset types are prohibited.")
    if allocation_bucket not in {"DOMESTIC_DIVERSIFIED", "INTERNATIONAL_EQUITY", "POWER_AND_GRID"}:
        raise PolicyViolation("Invalid strategic allocation bucket.")
    target = Decimal(str(decision.get("target_weight_pct", 0)))
    confidence = Decimal(str(decision.get("confidence", 0)))
    position_cap = POLICY.max_total_position_pct
    if target < 0 or target > position_cap:
        raise PolicyViolation(f"Target weight exceeds the {position_cap}% {asset_type} position cap.")
    if confidence < 0 or confidence > 1:
        raise PolicyViolation("Confidence must be between zero and one.")
    citations = decision.get("citations")
    if not isinstance(citations, list) or any(not isinstance(url, str) or not url.startswith("https://") for url in citations):
        raise PolicyViolation("Decision citations must be HTTPS URLs.")
    if action == "HOLD" and target < 0:
        raise PolicyViolation("HOLD cannot specify a negative target.")


def proposed_order(
    *,
    decision: dict[str, Any],
    net_liquidation: Decimal,
    cash: Decimal,
    current_quantity: Decimal,
    current_market_value: Decimal,
    asset_class_value: Decimal,
    bid: Decimal,
    ask: Decimal,
    turnover_used: Decimal,
) -> dict[str, Any] | None:
    validate_decision_shape(decision)
    action = str(decision["action"]).upper()
    asset_type = str(decision["asset_type"]).upper()
    if action == "HOLD":
        return None
    if net_liquidation <= 0 or bid <= 0 or ask <= 0:
        raise PolicyViolation("Portfolio value and valid bid/ask prices are required.")
    mid = (bid + ask) / 2
    spread_pct = (ask - bid) / mid * 100
    if asset_type == "US_EQUITY" and mid < POLICY.min_share_price:
        raise PolicyViolation("Penny stocks below $5 are not permitted.")
    if spread_pct > POLICY.max_spread_pct:
        raise PolicyViolation("Bid/ask spread exceeds 1%.")

    target_pct = Decimal(str(decision["target_weight_pct"]))
    desired_value = net_liquidation * target_pct / 100
    position_cap = POLICY.max_total_position_pct
    allocation_cap = Decimal("100") - POLICY.min_cash_reserve_pct
    max_total = net_liquidation * position_cap / 100
    desired_value = min(desired_value, max_total)

    if action == "BUY":
        desired_increase = max(Decimal("0"), desired_value - current_market_value)
        max_new_pct = POLICY.max_new_position_pct
        max_new = net_liquidation * max_new_pct / 100
        allocation_remaining = max(Decimal("0"), net_liquidation * allocation_cap / 100 - asset_class_value)
        reserve = net_liquidation * POLICY.min_cash_reserve_pct / 100
        affordable = max(Decimal("0"), cash - reserve)
        notional = min(desired_increase, max_new, allocation_remaining, affordable)
        price = ask * (Decimal("1") + POLICY.initial_slippage_pct / 100)
        risk_price = ask * (Decimal("1") + POLICY.max_slippage_pct / 100)
        quantity = quantity_for_asset_type(notional / risk_price, asset_type)
        side = "BUY"
    else:
        desired_decrease = max(Decimal("0"), current_market_value - desired_value)
        price = bid * (Decimal("1") - POLICY.initial_slippage_pct / 100)
        # A sell can receive price improvement up to the ask; use that larger
        # notional for the turnover cap even though the working limit is lower.
        risk_price = ask
        quantity = min(current_quantity, quantity_for_asset_type(desired_decrease / price, asset_type))
        side = "SELL"

    if quantity <= 0:
        return None
    notional = quantity * risk_price
    turnover_cap = net_liquidation * POLICY.max_turnover_pct / 100
    if turnover_used + notional > turnover_cap:
        remaining = max(Decimal("0"), turnover_cap - turnover_used)
        quantity = quantity_for_asset_type(remaining / risk_price, asset_type)
        notional = quantity * risk_price
    if quantity <= 0:
        raise PolicyViolation("The 20% per-run turnover cap leaves no order capacity.")
    if side == "SELL" and quantity > current_quantity:
        raise PolicyViolation("Sell quantity exceeds current long holdings.")
    return {
        "symbol": str(decision["symbol"]).upper(),
        "asset_type": asset_type,
        "side": side,
        "quantity": quantity,
        "limit_price": price.quantize(Decimal("0.01")),
        "estimated_notional": notional,
        "spread_pct": spread_pct,
    }
