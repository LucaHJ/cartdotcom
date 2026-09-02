from __future__ import annotations

import threading
import time
from dataclasses import asdict, dataclass
from decimal import Decimal
from typing import Any

from ibapi.client import EClient
from ibapi.contract import Contract
from ibapi.execution import ExecutionFilter
from ibapi.order import Order
from ibapi.wrapper import EWrapper

from app.config import settings
from app.database import fetch_one


TERMINAL_ORDER_STATES = {"Filled", "Cancelled", "ApiCancelled", "Inactive"}


def configured_paper_account() -> str:
    """Return the immutable secret account or the one-time discovered DB allowlist."""
    if settings.ibkr_paper_account:
        settings.validate_paper_boundary(settings.ibkr_paper_account)
        return settings.ibkr_paper_account
    row = fetch_one("SELECT value FROM app_settings WHERE key='paper_account_id'")
    candidate = str(row["value"]) if row and row.get("value") else ""
    settings.validate_paper_boundary(candidate)
    return candidate


class PaperAccountDiscovery(EWrapper, EClient):
    """Read only the accounts exposed on the hard-coded paper socket.

    This class deliberately has no order methods. It is used only until a
    single DU account is adopted as the persistent allowlist.
    """

    def __init__(self) -> None:
        settings.validate_paper_boundary("DUDISCOVERY")
        EWrapper.__init__(self)
        EClient.__init__(self, self)
        self._condition = threading.Condition()
        self._accounts: list[str] = []
        self._received = False
        self._thread: threading.Thread | None = None

    def managedAccounts(self, accountsList: str) -> None:  # noqa: N802
        with self._condition:
            self._accounts = [item.strip() for item in accountsList.split(",") if item.strip()]
            self._received = True
            self._condition.notify_all()

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson: str = "") -> None:
        del reqId, errorCode, errorString, advancedOrderRejectJson

    def discover(self, timeout: float = 15) -> list[str]:
        self.connect(settings.ibkr_host, 4002, clientId=settings.ibkr_client_id + 1)
        self._thread = threading.Thread(target=self.run, name="ibkr-paper-discovery", daemon=True)
        self._thread.start()
        deadline = time.monotonic() + timeout
        with self._condition:
            while not self._received:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Timed out waiting for IBKR paper account discovery.")
                self._condition.wait(min(remaining, 0.5))
        if len(self._accounts) != 1 or not self._accounts[0].startswith("DU"):
            raise RuntimeError("Automatic setup requires exactly one exposed DU paper account.")
        return list(self._accounts)

    def close(self) -> None:
        if self.isConnected():
            self.disconnect()


@dataclass
class Quote:
    symbol: str
    bid: Decimal
    ask: Decimal
    last: Decimal
    market_data_type: int


@dataclass
class BrokerOrderState:
    order_id: int
    perm_id: int = 0
    status: str = "PendingSubmit"
    filled: Decimal = Decimal("0")
    remaining: Decimal = Decimal("0")
    avg_fill_price: Decimal = Decimal("0")
    last_fill_price: Decimal = Decimal("0")
    why_held: str = ""


class PaperBroker(EWrapper, EClient):
    """Small synchronous facade over IBKR's callback API.

    The constructor fails unless the immutable paper-only settings pass. Every
    order carries the allowlisted DU account and the socket is fixed to port 4002.
    """

    def __init__(self, account_id: str | None = None) -> None:
        self.account_id = account_id or configured_paper_account()
        settings.validate_paper_boundary(self.account_id)
        EWrapper.__init__(self)
        EClient.__init__(self, self)
        self._condition = threading.Condition()
        self._thread: threading.Thread | None = None
        self._next_order_id: int | None = None
        self._accounts: list[str] = []
        self._errors: list[dict[str, Any]] = []
        self._account_values: dict[str, str] = {}
        self._positions: list[dict[str, Any]] = []
        self._positions_done = False
        self._open_orders: list[dict[str, Any]] = []
        self._open_orders_done = False
        self._contract_details: dict[int, list[Any]] = {}
        self._contract_done: set[int] = set()
        self._quotes: dict[int, dict[str, Any]] = {}
        self._quote_done: set[int] = set()
        self._order_states: dict[int, BrokerOrderState] = {}
        self._what_if_states: dict[int, dict[str, Any]] = {}
        self._executions: list[dict[str, Any]] = []
        self._execution_done: set[int] = set()
        self._request_id = 1000

    def _notify(self) -> None:
        with self._condition:
            self._condition.notify_all()

    def _wait(self, predicate: Any, timeout: float, label: str) -> None:
        deadline = time.monotonic() + timeout
        with self._condition:
            while not predicate():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(f"Timed out waiting for IBKR {label}.")
                self._condition.wait(min(remaining, 0.5))

    def _req_id(self) -> int:
        self._request_id += 1
        return self._request_id

    def connect_paper(self, timeout: float = 20) -> None:
        if self.isConnected():
            return
        self.connect(settings.ibkr_host, 4002, clientId=settings.ibkr_client_id)
        self._thread = threading.Thread(target=self.run, name="ibkr-api", daemon=True)
        self._thread.start()
        self._wait(lambda: self._next_order_id is not None and bool(self._accounts), timeout, "paper session")
        if self.account_id not in self._accounts:
            self.disconnect()
            raise RuntimeError("The connected IBKR session does not expose the allowlisted paper account.")
        if any(not account.startswith("DU") for account in self._accounts):
            self.disconnect()
            raise RuntimeError("A non-paper account was exposed by the gateway; trading is locked.")

    def disconnect_paper(self) -> None:
        if self.isConnected():
            self.disconnect()

    def nextValidId(self, orderId: int) -> None:  # noqa: N802
        with self._condition:
            self._next_order_id = max(orderId, self._next_order_id or 0)
            self._condition.notify_all()

    def managedAccounts(self, accountsList: str) -> None:  # noqa: N802
        with self._condition:
            self._accounts = [item.strip() for item in accountsList.split(",") if item.strip()]
            self._condition.notify_all()

    def error(self, reqId: int, errorCode: int, errorString: str, advancedOrderRejectJson: str = "") -> None:
        if errorCode not in {2104, 2106, 2107, 2108, 2158}:
            self._errors.append({
                "request_id": reqId,
                "code": errorCode,
                "message": errorString,
                "advanced_reject": advancedOrderRejectJson,
            })
        self._notify()

    def accountSummary(self, reqId: int, account: str, tag: str, value: str, currency: str) -> None:  # noqa: N802
        if account == self.account_id:
            self._account_values[tag] = value
            self._account_values[f"{tag}Currency"] = currency

    def accountSummaryEnd(self, reqId: int) -> None:  # noqa: N802
        self._account_values["_done"] = str(reqId)
        self._notify()

    def position(self, account: str, contract: Contract, position: Any, avgCost: float) -> None:
        if account != self.account_id:
            return
        self._positions.append({
            "account": account,
            "symbol": contract.symbol,
            "local_symbol": contract.localSymbol,
            "conid": contract.conId,
            "sec_type": contract.secType,
            "currency": contract.currency,
            "exchange": contract.exchange,
            "quantity": str(position),
            "average_cost": avgCost,
        })

    def positionEnd(self) -> None:  # noqa: N802
        self._positions_done = True
        self._notify()

    def openOrder(self, orderId: int, contract: Contract, order: Order, orderState: Any) -> None:  # noqa: N802
        if order.account != self.account_id:
            return
        if bool(getattr(order, "whatIf", False)):
            self._what_if_states[orderId] = {
                "status": str(orderState.status or ""),
                "initial_margin_change": str(orderState.initMarginChange or ""),
                "maintenance_margin_change": str(orderState.maintMarginChange or ""),
                "commission": str(orderState.commission),
                "commission_currency": str(orderState.commissionCurrency or ""),
                "warning": str(orderState.warningText or ""),
            }
            self._notify()
            return
        self._open_orders.append({
            "order_id": orderId,
            "perm_id": order.permId,
            "symbol": contract.symbol,
            "side": order.action,
            "type": order.orderType,
            "quantity": str(order.totalQuantity),
            "limit_price": order.lmtPrice,
            "status": orderState.status,
            "order_ref": order.orderRef,
        })

    def openOrderEnd(self) -> None:  # noqa: N802
        self._open_orders_done = True
        self._notify()

    def contractDetails(self, reqId: int, contractDetails: Any) -> None:  # noqa: N802
        self._contract_details.setdefault(reqId, []).append(contractDetails)

    def contractDetailsEnd(self, reqId: int) -> None:  # noqa: N802
        self._contract_done.add(reqId)
        self._notify()

    def marketDataType(self, reqId: int, marketDataType: int) -> None:  # noqa: N802
        self._quotes.setdefault(reqId, {})["market_data_type"] = marketDataType

    def tickPrice(self, reqId: int, tickType: int, price: float, attrib: Any) -> None:  # noqa: N802
        field = {1: "bid", 2: "ask", 4: "last"}.get(tickType)
        if field and price > 0:
            self._quotes.setdefault(reqId, {})[field] = price
            self._notify()

    def tickSnapshotEnd(self, reqId: int) -> None:  # noqa: N802
        self._quote_done.add(reqId)
        self._notify()

    def orderStatus(  # noqa: N802
        self, orderId: int, status: str, filled: Any, remaining: Any, avgFillPrice: float,
        permId: int, parentId: int, lastFillPrice: float, clientId: int, whyHeld: str,
        mktCapPrice: float,
    ) -> None:
        with self._condition:
            self._order_states[orderId] = BrokerOrderState(
                order_id=orderId,
                perm_id=permId,
                status=status,
                filled=Decimal(str(filled)),
                remaining=Decimal(str(remaining)),
                avg_fill_price=Decimal(str(avgFillPrice)),
                last_fill_price=Decimal(str(lastFillPrice)),
                why_held=whyHeld,
            )
            self._condition.notify_all()

    def execDetails(self, reqId: int, contract: Contract, execution: Any) -> None:  # noqa: N802
        if execution.acctNumber != self.account_id:
            return
        self._executions.append({
            "request_id": reqId,
            "exec_id": execution.execId,
            "order_id": execution.orderId,
            "perm_id": execution.permId,
            "account": execution.acctNumber,
            "symbol": contract.symbol,
            "side": execution.side,
            "shares": str(execution.shares),
            "price": execution.price,
            "time": execution.time,
            "exchange": execution.exchange,
            "order_ref": execution.orderRef,
        })

    def execDetailsEnd(self, reqId: int) -> None:  # noqa: N802
        self._execution_done.add(reqId)
        self._notify()

    def portfolio_snapshot(self) -> dict[str, Any]:
        self.connect_paper()
        req_id = self._req_id()
        self._account_values = {}
        tags = "NetLiquidation,TotalCashValue,AvailableFunds,BuyingPower,ExcessLiquidity,Currency"
        self.reqAccountSummary(req_id, "All", tags)
        self._wait(lambda: self._account_values.get("_done") == str(req_id), 20, "account summary")
        self.cancelAccountSummary(req_id)

        self._positions = []
        self._positions_done = False
        self.reqPositions()
        self._wait(lambda: self._positions_done, 20, "positions")
        self.cancelPositions()

        self._open_orders = []
        self._open_orders_done = False
        self.reqAllOpenOrders()
        self._wait(lambda: self._open_orders_done, 20, "open orders")
        return {
            "account_id": self.account_id,
            "currency": self._account_values.get("Currency", self._account_values.get("NetLiquidationCurrency", "USD")),
            "net_liquidation": self._number("NetLiquidation"),
            "total_cash": self._number("TotalCashValue"),
            "available_funds": self._number("AvailableFunds"),
            "buying_power": self._number("BuyingPower"),
            "excess_liquidity": self._number("ExcessLiquidity"),
            "positions": list(self._positions),
            "open_orders": list(self._open_orders),
        }

    def _number(self, key: str) -> str:
        value = self._account_values.get(key)
        if value is None:
            raise RuntimeError(f"IBKR account summary omitted {key}.")
        return str(Decimal(value))

    def resolve_stock(self, symbol: str) -> Contract:
        req_id = self._req_id()
        query = Contract()
        query.symbol = symbol.upper()
        query.secType = "STK"
        query.exchange = "SMART"
        query.currency = "USD"
        self._contract_details[req_id] = []
        self.reqContractDetails(req_id, query)
        self._wait(lambda: req_id in self._contract_done, 20, f"contract {symbol}")
        matches = [item.contract for item in self._contract_details.get(req_id, []) if item.contract.secType == "STK" and item.contract.currency == "USD"]
        if len(matches) != 1:
            raise RuntimeError(f"Ticker {symbol} did not resolve to exactly one USD stock contract.")
        return matches[0]

    def quote(self, contract: Contract) -> Quote:
        req_id = self._req_id()
        self._quotes[req_id] = {"market_data_type": 0}
        self.reqMarketDataType(1)
        self.reqMktData(req_id, contract, "", True, False, [])
        self._wait(
            lambda: req_id in self._quote_done or all(key in self._quotes[req_id] for key in ("bid", "ask", "last")),
            20,
            f"quote {contract.symbol}",
        )
        self.cancelMktData(req_id)
        values = self._quotes[req_id]
        if values.get("market_data_type") != 1:
            raise RuntimeError(f"Live market data is required for autonomous execution of {contract.symbol}.")
        return Quote(
            symbol=contract.symbol,
            bid=Decimal(str(values.get("bid", 0))),
            ask=Decimal(str(values.get("ask", 0))),
            last=Decimal(str(values.get("last", 0))),
            market_data_type=int(values.get("market_data_type", 0)),
        )

    def submit_limit_order(
        self, contract: Contract, side: str, quantity: Decimal, limit_price: Decimal, order_ref: str,
    ) -> int:
        if not self.isConnected() or self._next_order_id is None:
            raise RuntimeError("IBKR paper session is not connected.")
        if side not in {"BUY", "SELL"} or quantity <= 0 or quantity != quantity.to_integral_value():
            raise ValueError("Only positive whole-share BUY/SELL orders are supported.")
        order_id = self._next_order_id
        self._next_order_id += 1
        order = Order()
        order.account = self.account_id
        order.action = side
        order.orderType = "LMT"
        order.totalQuantity = quantity
        order.lmtPrice = float(limit_price)
        order.tif = "DAY"
        order.outsideRth = False
        order.transmit = True
        order.orderRef = order_ref
        # Current IB Gateway rejects the legacy defaults emitted by some
        # Python API package versions unless these retired attributes are
        # explicitly disabled (error 10268/10269).
        order.eTradeOnly = False
        order.firmQuoteOnly = False
        self._order_states[order_id] = BrokerOrderState(order_id=order_id, remaining=quantity)
        self.placeOrder(order_id, contract, order)
        return order_id

    def probe_us_stock_order_access(self, symbol: str = "SPY") -> dict[str, Any]:
        """Submit a non-executing IBKR What-If order to test API order access."""
        contract = self.resolve_stock(symbol)
        if self._next_order_id is None:
            raise RuntimeError("IBKR did not provide an order identifier for capability probing.")
        order_id = self._next_order_id
        self._next_order_id += 1
        order = Order()
        order.account = self.account_id
        order.action = "BUY"
        order.orderType = "LMT"
        order.totalQuantity = Decimal("1")
        order.lmtPrice = 100.0
        order.tif = "DAY"
        order.outsideRth = False
        order.transmit = True
        order.whatIf = True
        order.overridePercentageConstraints = True
        order.eTradeOnly = False
        order.firmQuoteOnly = False
        error_offset = len(self._errors)
        self.placeOrder(order_id, contract, order)
        self._wait(
            lambda: order_id in self._what_if_states
            or any(item.get("request_id") == order_id for item in self._errors[error_offset:]),
            20,
            "US-stock What-If capability probe",
        )
        errors = [item for item in self._errors[error_offset:] if item.get("request_id") == order_id]
        state = self._what_if_states.get(order_id)
        return {
            "symbol": symbol,
            "what_if": True,
            "allowed": bool(state) and not errors and state.get("status") != "Inactive",
            "order_state": state,
            "errors": errors,
        }

    def wait_order(self, order_id: int, timeout: int) -> BrokerOrderState:
        self._wait(
            lambda: order_id in self._order_states and self._order_states[order_id].status in TERMINAL_ORDER_STATES,
            timeout,
            f"terminal order status {order_id}",
        )
        return self._order_states[order_id]

    def cancel_and_wait(self, order_id: int, timeout: int = 30) -> BrokerOrderState:
        self.cancelOrder(order_id, "paper-execution-timeout")
        return self.wait_order(order_id, timeout)

    def executions(self) -> list[dict[str, Any]]:
        req_id = self._req_id()
        filt = ExecutionFilter()
        filt.acctCode = self.account_id
        self.reqExecutions(req_id, filt)
        self._wait(lambda: req_id in self._execution_done, 20, "executions")
        return [item for item in self._executions if item["request_id"] == req_id]
