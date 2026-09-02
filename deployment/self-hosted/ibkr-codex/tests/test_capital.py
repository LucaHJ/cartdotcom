from decimal import Decimal

import pytest

from app.capital import initial_protected_principal, protected_cash_floor, virtual_cash_available


def test_virtual_capital_keeps_980k_principal_and_new_interest_protected() -> None:
    principal = initial_protected_principal(Decimal("1000000"), Decimal("20000"))
    floor = protected_cash_floor(principal, Decimal("1097.20"), Decimal("0"))

    assert principal == Decimal("980000")
    assert floor == Decimal("981097.20")
    assert virtual_cash_available(Decimal("1001097.20"), floor) == Decimal("20000")


def test_virtual_capital_cannot_be_created_from_insufficient_cash() -> None:
    with pytest.raises(ValueError, match="insufficient"):
        initial_protected_principal(Decimal("20000"), Decimal("20000"))
