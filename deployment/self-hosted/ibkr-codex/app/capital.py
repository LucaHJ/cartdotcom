from __future__ import annotations

from decimal import Decimal


def initial_protected_principal(total_cash: Decimal, virtual_capital: Decimal) -> Decimal:
    if virtual_capital <= 0:
        raise ValueError("Virtual investable capital must be positive.")
    if total_cash <= virtual_capital:
        raise ValueError("Total cash is insufficient to establish the protected cash reserve.")
    return total_cash - virtual_capital


def protected_cash_floor(principal: Decimal, accrued_cash: Decimal, accrued_high_water: Decimal) -> Decimal:
    """Protect principal and all accrued interest, including interest already booked."""
    return principal + max(Decimal("0"), accrued_cash, accrued_high_water)


def virtual_cash_available(total_cash: Decimal, protected_floor: Decimal) -> Decimal:
    return max(Decimal("0"), total_cash - protected_floor)
