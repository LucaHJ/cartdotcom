"""Read-only deployment check. Use a dedicated client id distinct from the worker."""
import json
from importlib.metadata import version
from app.broker import PaperBroker
from app.config import settings

if settings.ibkr_client_id == 41:
    raise RuntimeError("Set IBKR_CLIENT_ID=43 for this independent read-only check.")
broker = PaperBroker()
try:
    broker.connect_paper()
    snapshot = broker.portfolio_snapshot()
    result = dict(sdk=version("ibapi"), protocol=broker.serverVersion(), account=snapshot["account_id"],
                  currency=snapshot["currency"], holdings=len(snapshot["positions"]), open_orders=len(snapshot["open_orders"]))
    fx = broker.resolve_base_to_usd_fx(snapshot["currency"])
    for name, contract in (("fx", fx), ("stock", broker.resolve_stock("SPY"))):
        if contract is None:
            continue
        try:
            quote = broker.quote(contract)
            result[name] = dict(bid=str(quote.bid), ask=str(quote.ask), last=str(quote.last), source=quote.source_label)
        except Exception as exc:
            result[name] = dict(error=str(exc))
    ledger = []
    original = broker.accountSummary
    def ledger_value(req_id, account, tag, value, currency):
        if tag.endswith("ExchangeRate"):
            ledger.append(dict(tag=tag, value=value, currency=currency))
        original(req_id, account, tag, value, currency)
    broker.accountSummary = ledger_value
    req_id = broker._req_id()
    broker._account_summary_request_id = req_id
    try:
        broker.reqAccountSummary(req_id, "All", "$LEDGER:ALL")
        broker._wait(lambda: broker._account_summary_complete(req_id), 20, "ledger snapshot")
    finally:
        broker._account_summary_request_id = None
        broker.cancelAccountSummary(req_id)
    result["ledger_fx"] = ledger
    result["error_codes"] = sorted(set(x["code"] for x in broker._errors))
    print(json.dumps(result))
finally:
    broker.disconnect_paper()
