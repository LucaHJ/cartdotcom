from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from decimal import Decimal, ROUND_DOWN
from typing import Any


@dataclass(frozen=True)
class RiskPolicy:
    max_new_position_pct: Decimal = Decimal("5")
    max_total_position_pct: Decimal = Decimal("15")
    max_turnover_pct: Decimal = Decimal("20")
    min_cash_reserve_pct: Decimal = Decimal("5")
    max_orders_per_run: int = 5
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

    def public(self) -> dict[str, Any]:
        result = asdict(self)
        return {key: float(value) if isinstance(value, Decimal) else value for key, value in result.items()}


POLICY = RiskPolicy()


class PolicyViolation(ValueError):
    pass


def whole_shares(value: Decimal) -> Decimal:
    return value.quantize(Decimal("1"), rounding=ROUND_DOWN)


def validate_decision_shape(decision: dict[str, Any]) -> None:
    symbol = str(decision.get("symbol", "")).strip().upper()
    action = str(decision.get("action", "")).upper()
    if not symbol or len(symbol) > 12 or not all(c.isalnum() or c in ".-" for c in symbol):
        raise PolicyViolation("Invalid ticker symbol.")
    if action not in {"BUY", "SELL", "HOLD"}:
        raise PolicyViolation("Action must be BUY, SELL, or HOLD.")
    target = Decimal(str(decision.get("target_weight_pct", 0)))
    confidence = Decimal(str(decision.get("confidence", 0)))
    if target < 0 or target > POLICY.max_total_position_pct:
        raise PolicyViolation("Target weight exceeds the 15% long-only position cap.")
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
    bid: Decimal,
    ask: Decimal,
    turnover_used: Decimal,
) -> dict[str, Any] | None:
    validate_decision_shape(decision)
    action = str(decision["action"]).upper()
    if action == "HOLD":
        return None
    if net_liquidation <= 0 or bid <= 0 or ask <= 0:
        raise PolicyViolation("Portfolio value and valid bid/ask prices are required.")
    mid = (bid + ask) / 2
    spread_pct = (ask - bid) / mid * 100
    if mid < POLICY.min_share_price:
        raise PolicyViolation("Penny stocks below $5 are not permitted.")
    if spread_pct > POLICY.max_spread_pct:
        raise PolicyViolation("Bid/ask spread exceeds 1%.")

    target_pct = Decimal(str(decision["target_weight_pct"]))
    desired_value = net_liquidation * target_pct / 100
    max_total = net_liquidation * POLICY.max_total_position_pct / 100
    desired_value = min(desired_value, max_total)

    if action == "BUY":
        desired_increase = max(Decimal("0"), desired_value - current_market_value)
        max_new = net_liquidation * POLICY.max_new_position_pct / 100
        reserve = net_liquidation * POLICY.min_cash_reserve_pct / 100
        affordable = max(Decimal("0"), cash - reserve)
        notional = min(desired_increase, max_new, affordable)
        price = ask * (Decimal("1") + POLICY.initial_slippage_pct / 100)
        risk_price = ask * (Decimal("1") + POLICY.max_slippage_pct / 100)
        quantity = whole_shares(notional / risk_price)
        side = "BUY"
    else:
        desired_decrease = max(Decimal("0"), current_market_value - desired_value)
        price = bid * (Decimal("1") - POLICY.initial_slippage_pct / 100)
        # A sell can receive price improvement up to the ask; use that larger
        # notional for the turnover cap even though the working limit is lower.
        risk_price = ask
        quantity = min(current_quantity, whole_shares(desired_decrease / price))
        side = "SELL"

    if quantity <= 0:
        return None
    notional = quantity * risk_price
    turnover_cap = net_liquidation * POLICY.max_turnover_pct / 100
    if turnover_used + notional > turnover_cap:
        remaining = max(Decimal("0"), turnover_cap - turnover_used)
        quantity = whole_shares(remaining / risk_price)
        notional = quantity * risk_price
    if quantity <= 0:
        raise PolicyViolation("The 20% per-run turnover cap leaves no order capacity.")
    if side == "SELL" and quantity > current_quantity:
        raise PolicyViolation("Sell quantity exceeds current long holdings.")
    return {
        "symbol": str(decision["symbol"]).upper(),
        "side": side,
        "quantity": quantity,
        "limit_price": price.quantize(Decimal("0.01")),
        "estimated_notional": notional,
        "spread_pct": spread_pct,
    }
