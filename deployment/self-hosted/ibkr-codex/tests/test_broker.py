from decimal import Decimal

from app.broker import PaperBroker
from ibapi.contract import Contract
from ibapi.order_cancel import OrderCancel
import pytest


def test_delayed_tick_fields_normalize_to_bid_ask_last() -> None:
    broker = PaperBroker("DU123456")
    broker._quotes[1001] = {}

    broker.tickPrice(1001, 66, 101.10, None)
    broker.tickPrice(1001, 67, 101.20, None)
    broker.tickPrice(1001, 68, 101.15, None)

    assert broker._quotes[1001] == {"bid": 101.10, "ask": 101.20, "last": 101.15}
    assert Decimal(str(broker._quotes[1001]["last"])) > 0


@pytest.mark.parametrize("code", [354, 10167])
def test_delayed_market_data_handoff_is_not_a_rejection(code) -> None:
    broker = PaperBroker("DU123456")
    broker._delayed_quote_requests.add(1001)

    broker.error(1001, 0, code, "Requested market data is not subscribed. Displaying delayed market data.")

    assert broker._errors == []


def test_fx_quote_uses_bid_ask_without_requiring_trade_price(monkeypatch):
    broker = PaperBroker("DU123456")
    contract = Contract()
    contract.symbol, contract.currency, contract.secType = "AUD", "USD", "CASH"
    monkeypatch.setattr(broker, "reqMarketDataType", lambda _: None)
    monkeypatch.setattr(broker, "cancelMktData", lambda _: None)
    def reply(req_id, *_):
        broker._quotes[req_id] = {"bid": 0.65, "ask": 0.66, "market_data_type": 1}
    monkeypatch.setattr(broker, "reqMktData", reply)
    quote = broker._quote_once(contract, 1)
    assert quote.bid == Decimal("0.65")
    assert quote.last == Decimal("0.655")


def test_quote_timeout_cancels_subscription(monkeypatch):
    broker = PaperBroker("DU123456")
    contract = Contract()
    contract.symbol, contract.secType = "SPY", "STK"
    cancelled = []
    monkeypatch.setattr(broker, "reqMarketDataType", lambda _: None)
    monkeypatch.setattr(broker, "reqMktData", lambda *_: None)
    monkeypatch.setattr(broker, "cancelMktData", cancelled.append)
    def timeout(*_):
        raise TimeoutError("test")
    monkeypatch.setattr(broker, "_wait", timeout)
    with pytest.raises(TimeoutError):
        broker._quote_once(contract, 3)
    assert len(cancelled) == 1
    assert not broker._delayed_quote_requests


def test_cancel_uses_current_sdk_order_cancel_type(monkeypatch):
    broker = PaperBroker("DU123456")
    captured = []
    monkeypatch.setattr(broker, "cancelOrder", lambda *args: captured.append(args))
    monkeypatch.setattr(broker, "wait_order", lambda *_: "confirmed")
    assert broker.cancel_and_wait(1) == "confirmed"
    assert isinstance(captured[0][1], OrderCancel)
