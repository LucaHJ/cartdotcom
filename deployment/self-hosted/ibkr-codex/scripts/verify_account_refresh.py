"""Read-only regression check against the paper gateway; never submits orders."""
import json
import time

from app.broker import PaperBroker
from app.config import settings

if settings.ibkr_client_id != 43:
    raise RuntimeError("Use the dedicated diagnostic client id: IBKR_CLIENT_ID=43.")


class ReadOnlyBroker(PaperBroker):
    def placeOrder(self, *args, **kwargs):
        raise RuntimeError("Order submission is disabled in this diagnostic.")


broker = ReadOnlyBroker()
try:
    broker.connect_paper()
    for attempt in range(6):
        started = time.monotonic()
        snapshot = broker.portfolio_snapshot()
        print(json.dumps({"refresh": attempt + 1, "ok": True,
                          "seconds": round(time.monotonic() - started, 3),
                          "holdings": len(snapshot["positions"]),
                          "open_orders": len(snapshot["open_orders"])}), flush=True)
finally:
    broker.disconnect_paper()
