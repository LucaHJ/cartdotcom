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


def test_delayed_market_data_handoff_is_not_a_rejection() -> None:
    broker = PaperBroker("DU123456")
    broker._delayed_quote_requests.add(1001)

    broker.error(1001, 354, "Requested market data is not subscribed. Displaying delayed market data.")

    assert broker._errors == []
