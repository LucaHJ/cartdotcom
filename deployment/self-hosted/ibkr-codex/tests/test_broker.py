from decimal import Decimal

from app.broker import PaperBroker


def test_delayed_tick_fields_normalize_to_bid_ask_last() -> None:
    broker = PaperBroker("DU123456")
    broker._quotes[1001] = {}

    broker.tickPrice(1001, 66, 101.10, None)
    broker.tickPrice(1001, 67, 101.20, None)
    broker.tickPrice(1001, 68, 101.15, None)

    assert broker._quotes[1001] == {"bid": 101.10, "ask": 101.20, "last": 101.15}
    assert Decimal(str(broker._quotes[1001]["last"])) > 0
