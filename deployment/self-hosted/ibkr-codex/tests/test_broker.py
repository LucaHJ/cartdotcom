from decimal import Decimal

from app.broker import PaperBroker
from ibapi.client import EClient
from ibapi.contract import Contract
from ibapi.message import OUT
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


def test_account_summary_cancel_uses_legacy_frame_only(monkeypatch):
    broker = PaperBroker("DU123456")
    monkeypatch.setattr(EClient, "useProtoBuf", lambda self, msg: True)
    assert broker.useProtoBuf(OUT.CANCEL_ACCOUNT_SUMMARY) is False
    assert broker.useProtoBuf(OUT.PLACE_ORDER) is True
    assert broker.useProtoBuf(OUT.REQ_ACCOUNT_SUMMARY) is True
    monkeypatch.setattr(broker, "isConnected", lambda: True)
    captured = []
    monkeypatch.setattr(broker, "sendMsg", lambda *args: captured.append(args))
    monkeypatch.setattr(broker, "sendMsgProtoBuf", lambda *_: pytest.fail("Unexpected protobuf cancellation"))
    broker.cancelAccountSummary(1001)
    assert captured == [(OUT.CANCEL_ACCOUNT_SUMMARY, "1\0" + "1001\0")]


def test_account_summary_rejection_is_immediate_and_cleans_up(monkeypatch):
    broker = PaperBroker("DU123456")
    cancelled = []
    monkeypatch.setattr(broker, "connect_paper", lambda: None)
    monkeypatch.setattr(broker, "cancelAccountSummary", cancelled.append)
    monkeypatch.setattr(broker, "reqPositions", lambda: pytest.fail("Must not proceed after rejection"))
    monkeypatch.setattr(broker, "reqAccountSummary", lambda req, *_: broker.error(req, 0, 322, "Maximum account summary requests exceeded"))
    # A rejected request must raise before waiting, not consume the 20-second timeout.
    monkeypatch.setattr(broker._condition, "wait", lambda *_: pytest.fail("Rejection was ignored"))
    with pytest.raises(RuntimeError, match="code 322"):
        broker.portfolio_snapshot()
    assert cancelled == [1001]
    assert broker._account_summary_request_id is None


def test_account_summary_timeout_always_cancels(monkeypatch):
    broker = PaperBroker("DU123456")
    cancelled = []
    monkeypatch.setattr(broker, "connect_paper", lambda: None)
    monkeypatch.setattr(broker, "reqAccountSummary", lambda *_: None)
    monkeypatch.setattr(broker, "cancelAccountSummary", cancelled.append)
    def timeout(*_):
        raise TimeoutError("test account summary timeout")
    monkeypatch.setattr(broker, "_wait", timeout)
    with pytest.raises(TimeoutError):
        broker.portfolio_snapshot()
    assert cancelled == [1001]
    assert broker._account_summary_request_id is None


def test_repeated_snapshots_ignore_late_callbacks_and_cancel_each_request(monkeypatch):
    broker = PaperBroker("DU123456")
    cancelled = []
    monkeypatch.setattr(broker, "connect_paper", lambda: None)
    monkeypatch.setattr(broker, "cancelAccountSummary", cancelled.append)
    monkeypatch.setattr(broker, "reqPositions", broker.positionEnd)
    monkeypatch.setattr(broker, "cancelPositions", lambda: None)
    monkeypatch.setattr(broker, "reqAllOpenOrders", broker.openOrderEnd)
    def reply(req, *_):
        for tag in ("NetLiquidation", "TotalCashValue", "AccruedCash", "AvailableFunds", "BuyingPower", "ExcessLiquidity"):
            broker.accountSummary(req, broker.account_id, tag, "1000", "USD")
        broker.accountSummaryEnd(req)
        broker.accountSummary(req - 1, broker.account_id, "TotalCashValue", "999999", "USD")
        broker.accountSummaryEnd(req - 1)
        broker.accountSummary(req, "DUOTHER", "TotalCashValue", "999999", "USD")
    monkeypatch.setattr(broker, "reqAccountSummary", reply)
    for _ in range(4):
        snapshot = broker.portfolio_snapshot()
        assert snapshot["total_cash"] == "1000"
        assert broker._account_summary_request_id is None
    assert cancelled == [1001, 1002, 1003, 1004]
    broker.accountSummary(1004, broker.account_id, "TotalCashValue", "999999", "USD")
    assert broker._account_values["TotalCashValue"] == "1000"
