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
from ibapi.order_cancel import OrderCancel
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

    def error(self, reqId: int, errorTime: int, errorCode: int, errorString: str, advancedOrderRejectJson: str = "") -> None:
        del reqId, errorTime, errorCode, errorString, advancedOrderRejectJson

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

    @property
    def is_delayed(self) -> bool:
        return self.market_data_type in {3, 4}

    @property
    def source_label(self) -> str:
        return {1: "live", 3: "delayed", 4: "delayed-frozen"}.get(
            self.market_data_type, f"unknown-{self.market_data_type}"
        )


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
        self._delayed_quote_requests: set[int] = set()
        self._order_states: dict[int, BrokerOrderState] = {}
        self._what_if_states: dict[int, dict[str, Any]] = {}
        self._executions: list[dict[str, Any]] = []
        self._execution_done: set[int] = set()
        self._request_id = 1000
        self._completed_orders: list[dict[str, Any]] = []
        self._completed_orders_done = False

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

    def error(self, reqId: int, errorTime: int, errorCode: int, errorString: str, advancedOrderRejectJson: str = "") -> None:
        # IBKR uses the same callback for its informational delayed-data
        # handoff ("Displaying delayed market data") as it uses for a true
        # missing-subscription error. The former is expected after an explicit
        # reqMarketDataType(3) request and the quote callbacks follow it.
        delayed_handoff = (
            reqId in self._delayed_quote_requests
            and errorCode in {354, 10167}
            and "displaying delayed market data" in errorString.lower()
        )
        if errorCode not in {2104, 2106, 2107, 2108, 2158} and not delayed_handoff:
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
        # Delayed snapshots use a parallel set of tick fields: 66/67/68
        # correspond to the ordinary live fields 1/2/4.  Normalize both
        # protocols so the later order-validation path remains identical.
        field = {1: "bid", 2: "ask", 4: "last", 66: "bid", 67: "ask", 68: "last"}.get(tickType)
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
        tags = "NetLiquidation,TotalCashValue,AccruedCash,AvailableFunds,BuyingPower,ExcessLiquidity,Currency"
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
            "accrued_cash": self._number("AccruedCash"),
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

    def resolve_crypto(self, symbol: str) -> Contract:
        """Resolve only the two USD crypto contracts the policy permits."""
        if symbol.upper() not in {"BTC", "ETH"}:
            raise RuntimeError("Only BTC and ETH are permitted crypto contracts.")
        req_id = self._req_id()
        query = Contract()
        query.symbol = symbol.upper()
        query.secType = "CRYPTO"
        query.exchange = "PAXOS"
        query.currency = "USD"
        self._contract_details[req_id] = []
        self.reqContractDetails(req_id, query)
        self._wait(lambda: req_id in self._contract_done, 20, f"crypto contract {symbol}")
        matches = [
            item.contract for item in self._contract_details.get(req_id, [])
            if item.contract.secType == "CRYPTO" and item.contract.currency == "USD" and item.contract.exchange == "PAXOS"
        ]
        if len(matches) != 1:
            raise RuntimeError(f"Crypto ticker {symbol} did not resolve to exactly one USD PAXOS contract.")
        return matches[0]

    def resolve_instrument(self, symbol: str, asset_type: str) -> Contract:
        if asset_type == "US_EQUITY":
            return self.resolve_stock(symbol)
        if asset_type == "CRYPTO":
            return self.resolve_crypto(symbol)
        raise RuntimeError(f"Unsupported asset type {asset_type}.")

    def resolve_base_to_usd_fx(self, base_currency: str) -> Contract | None:
        """Resolve the USD value of one unit of the account base currency."""
        if base_currency.upper() == "USD":
            return None
        req_id = self._req_id()
        query = Contract()
        query.symbol = base_currency.upper()
        query.secType = "CASH"
        query.exchange = "IDEALPRO"
        query.currency = "USD"
        self._contract_details[req_id] = []
        self.reqContractDetails(req_id, query)
        self._wait(lambda: req_id in self._contract_done, 20, f"FX contract {base_currency}.USD")
        matches = [
            item.contract for item in self._contract_details.get(req_id, [])
            if item.contract.secType == "CASH" and item.contract.symbol == base_currency.upper() and item.contract.currency == "USD"
        ]
        if len(matches) != 1:
            raise RuntimeError(f"Could not resolve exactly one {base_currency}.USD FX contract for capital protection.")
        return matches[0]

    def _quote_once(self, contract: Contract, requested_type: int) -> Quote:
        req_id = self._req_id()
        self._quotes[req_id] = {"market_data_type": 0}
        if requested_type == 3:
            self._delayed_quote_requests.add(req_id)
        error_offset = len(self._errors)
        self.reqMarketDataType(requested_type)
        self.reqMktData(req_id, contract, "", True, False, [])
        try:
            self._wait(
                lambda: all(key in self._quotes[req_id] for key in (("bid", "ask") if contract.secType == "CASH" else ("bid", "ask", "last")))
                or any(item.get("request_id") == req_id for item in self._errors[error_offset:]),
                20,
                f"quote {contract.symbol}",
            )
        finally:
            self.cancelMktData(req_id)
            self._delayed_quote_requests.discard(req_id)
        values = self._quotes[req_id]
        if contract.secType == "CASH" and values.get("bid", 0) > 0 and values.get("ask", 0) > 0:
            values.setdefault("last", (values["bid"] + values["ask"]) / 2)
        errors = [item for item in self._errors[error_offset:] if item.get("request_id") == req_id]
        if errors:
            raise RuntimeError(f"IBKR market data rejected for {contract.symbol}: {errors[-1]['message']}")
        data_type = int(values.get("market_data_type", 0))
        if data_type != requested_type:
            raise RuntimeError(
                f"IBKR returned market-data type {data_type} for {contract.symbol}; expected {requested_type}."
            )
        missing = [key for key in ("bid", "ask", "last") if Decimal(str(values.get(key, 0))) <= 0]
        if missing:
            raise RuntimeError(f"IBKR {Quote(contract.symbol, Decimal('0'), Decimal('0'), Decimal('0'), data_type).source_label} quote for {contract.symbol} omitted {', '.join(missing)}.")
        return Quote(
            symbol=contract.symbol,
            bid=Decimal(str(values.get("bid", 0))),
            ask=Decimal(str(values.get("ask", 0))),
            last=Decimal(str(values.get("last", 0))),
            market_data_type=data_type,
        )

    def quote(self, contract: Contract) -> Quote:
        """Return live data, or owner-authorized delayed data as a clear fallback."""
        try:
            return self._quote_once(contract, 1)
        except Exception as live_error:
            if not settings.allow_delayed_market_data:
                raise RuntimeError(f"Live market data is required for {contract.symbol}: {live_error}") from live_error
            try:
                return self._quote_once(contract, 3)
            except Exception as delayed_error:
                raise RuntimeError(
                    f"Neither live nor authorized delayed market data is usable for {contract.symbol}. "
                    f"Live: {live_error}; delayed: {delayed_error}"
                ) from delayed_error

    def submit_limit_order(
        self, contract: Contract, side: str, quantity: Decimal, limit_price: Decimal, order_ref: str,
    ) -> int:
        if not self.isConnected() or self._next_order_id is None:
            raise RuntimeError("IBKR paper session is not connected.")
        settings.validate_paper_boundary(self.account_id)
        if contract.secType != "STK" or contract.currency != "USD":
            raise ValueError("Only USD stock contracts may receive orders; crypto is prohibited.")
        if side not in {"BUY", "SELL"} or quantity <= 0 or quantity != quantity.to_integral_value():
            raise ValueError("Only positive whole-share stock BUY/SELL orders are supported.")
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

    def probe_crypto_order_access(self, symbol: str = "BTC") -> dict[str, Any]:
        """Submit a non-executing crypto What-If; failure leaves crypto disabled."""
        contract = self.resolve_crypto(symbol)
        if self._next_order_id is None:
            raise RuntimeError("IBKR did not provide an order identifier for crypto capability probing.")
        order_id = self._next_order_id
        self._next_order_id += 1
        order = Order()
        order.account = self.account_id
        order.action = "BUY"
        order.orderType = "LMT"
        order.totalQuantity = Decimal("0.0001")
        order.lmtPrice = 100.0
        order.tif = "IOC"
        order.outsideRth = True
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
            "crypto What-If capability probe",
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
        self.cancelOrder(order_id, OrderCancel())
        return self.wait_order(order_id, timeout)

    def completedOrder(self, contract: Contract, order: Order, orderState: Any) -> None:  # noqa: N802
        if order.account == self.account_id:
            self._completed_orders.append({
                "order_id": order.orderId, "perm_id": order.permId,
                "order_ref": order.orderRef, "status": orderState.status,
                "filled": str(order.filledQuantity),
            })

    def completedOrdersEnd(self) -> None:  # noqa: N802
        self._completed_orders_done = True
        self._notify()

    def completed_orders(self) -> list[dict[str, Any]]:
        self._completed_orders = []
        self._completed_orders_done = False
        self.reqCompletedOrders(False)
        self._wait(lambda: self._completed_orders_done, 20, "completed orders")
        return list(self._completed_orders)

    def executions(self) -> list[dict[str, Any]]:
        req_id = self._req_id()
        filt = ExecutionFilter()
        filt.acctCode = self.account_id
        self.reqExecutions(req_id, filt)
        self._wait(lambda: req_id in self._execution_done, 20, "executions")
        return [item for item in self._executions if item["request_id"] == req_id]
