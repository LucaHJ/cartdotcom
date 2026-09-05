from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from app.artifacts import read_artifact, retention_status
from app.config import settings
from app.database import add_event, fetch_all, fetch_one, migrate, set_setting, setting_bool
from app.notifications import validation_token_valid
from app.performance import latest_strategy_performance, strategy_performance_history
from app.policy import POLICY
from app.schedule import daily_checkpoint_time, research_day_status
from app.workflow import queue_run


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    migrate()
    yield


app = FastAPI(title="IBKR Codex Paper Trader", docs_url=None, redoc_url=None, lifespan=lifespan)
STATIC_ROOT = Path(__file__).resolve().parent.parent / "static"


class SwitchRequest(BaseModel):
    engaged: bool


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        return ""
    return authorization[7:]


def dashboard_auth(authorization: str | None = Header(default=None)) -> None:
    if not settings.news_signal_token or _bearer(authorization) != settings.news_signal_token:
        raise HTTPException(status_code=401, detail="Valid dashboard authorization is required.")


def internal_auth(authorization: str | None = Header(default=None)) -> None:
    if not settings.internal_api_token or _bearer(authorization) != settings.internal_api_token:
        raise HTTPException(status_code=401, detail="Valid internal authorization is required.")


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    row = fetch_one("SELECT 1 AS ok")
    return {"ok": bool(row), "paper_only": True}


@app.get("/", response_class=FileResponse)
def dashboard() -> FileResponse:
    return FileResponse(STATIC_ROOT / "index.html")


@app.get("/api/policy", dependencies=[Depends(dashboard_auth)])
def policy() -> dict[str, Any]:
    return {
        "paper_only": True,
        "account_pattern": "DU…",
        "ib_gateway_port": 4002,
        "limits": POLICY.public(),
        "prohibited": [
            "live accounts", "short sales", "margin borrowing", "options", "futures",
            "crypto", "forex", "fractional stock shares", "after-hours stock orders", "market orders",
        ],
        "asset_classes": {
            "US_EQUITY": "Liquid US-listed USD stocks and ordinary unleveraged ETFs, including international underlying exposure; 95% total strategic target.",
            "CASH_RESERVE": "At least 5% is retained as cash.",
        },
        "execution": "DAY limit orders; monitor each attempt, reprice at most 3 times, then cancel and reconcile. "
                     "International/power allocations are standing research targets, not forced trades. "
                     f"FX: prefer IBKR; fallback to official daily ECB reference rates, at most {settings.fx_fallback_max_age_days} calendar days old, "
                     f"with a {settings.fx_fallback_haircut_pct}% conservative sizing haircut. Stock bid/ask quotes still come from IBKR.",
    }


@app.get("/api/status", dependencies=[Depends(dashboard_auth)])
def status() -> dict[str, Any]:
    now = datetime.now(UTC)
    day = research_day_status(now)
    latest = fetch_one("SELECT * FROM research_runs ORDER BY created_at DESC LIMIT 1")
    broker = fetch_one("SELECT * FROM broker_status WHERE singleton=true")
    queued = fetch_one("SELECT count(*) AS count FROM research_runs WHERE status='queued'")
    running = fetch_one(
        "SELECT * FROM research_runs WHERE status IN ('snapshotting','researching','validating') "
        "ORDER BY started_at DESC LIMIT 1"
    )
    return jsonable_encoder({
        "paper_only": True,
        "kill_switch": setting_bool("kill_switch", True),
        "trading_enabled": setting_bool("trading_enabled", False),
        "broker": broker,
        "latest_run": latest,
        "active_run": running,
        "queued_runs": int(queued["count"]) if queued else 0,
        "execution_queue": fetch_all(
            "SELECT q.*,r.decision_summary FROM execution_queue q JOIN research_runs r ON r.id=q.run_id "
            "ORDER BY q.created_at DESC LIMIT 20"),
        "schedule": {
            "strategy": "Daily US-calendar checkpoint; Codex runs only on regular, non-holiday NYSE days",
            "regular_time": settings.trading_time_et,
            "timezone": "America/New_York",
            "calendar": "US federal holidays and NYSE",
            "early_close_adjusted": True,
            "current": day,
            "today_checkpoint": daily_checkpoint_time(now),
        },
        "retention": retention_status(),
        "fx_reference": fetch_one("SELECT * FROM fx_rate_cache WHERE base_currency='AUD' AND quote_currency='USD'"),
        "capital_protection": {
            "reserve_principal": fetch_one("SELECT value FROM app_settings WHERE key='virtual_cash_reserve_principal'"),
            "interest_baseline": fetch_one("SELECT value FROM app_settings WHERE key='virtual_cash_reserve_accrued_baseline'"),
            "currency": fetch_one("SELECT value FROM app_settings WHERE key='virtual_cash_reserve_currency'"),
            "virtual_capital": fetch_one("SELECT value FROM app_settings WHERE key='virtual_investable_capital'"),
        },
    })


@app.get("/api/runs", dependencies=[Depends(dashboard_auth)])
def runs(limit: int = Query(default=30, ge=1, le=200)) -> Any:
    return jsonable_encoder(fetch_all("SELECT * FROM research_runs ORDER BY created_at DESC LIMIT %s", (limit,)))


@app.get("/api/runs/{run_id}", dependencies=[Depends(dashboard_auth)])
def run_detail(run_id: uuid.UUID) -> Any:
    run = fetch_one("SELECT * FROM research_runs WHERE id=%s", (run_id,))
    if not run:
        raise HTTPException(status_code=404, detail="Run not found.")
    public_run = dict(run)
    context = dict(public_run.get("research_context") or {})
    for key in ("net_liquidation", "total_cash", "available_funds", "buying_power", "excess_liquidity", "accrued_cash"):
        context.pop(key, None)
    if context:
        public_run["research_context"] = context
    snapshots = fetch_all("SELECT * FROM portfolio_snapshots WHERE run_id=%s ORDER BY captured_at", (run_id,))
    for snapshot in snapshots:
        for key in ("net_liquidation", "total_cash", "available_funds", "buying_power", "excess_liquidity", "accrued_cash"):
            snapshot.pop(key, None)
    return jsonable_encoder({
        "run": public_run,
        "events": fetch_all("SELECT * FROM run_events WHERE run_id=%s ORDER BY created_at", (run_id,)),
        "decisions": fetch_all("SELECT * FROM decisions WHERE run_id=%s ORDER BY created_at", (run_id,)),
        "orders": fetch_all("SELECT * FROM orders WHERE run_id=%s ORDER BY created_at", (run_id,)),
        "execution": fetch_one("SELECT * FROM execution_queue WHERE run_id=%s", (run_id,)),
        "snapshots": snapshots,
        "portfolio_performance": latest_strategy_performance(),
    })


@app.get("/api/runs/{run_id}/artifact/{kind}", dependencies=[Depends(dashboard_auth)])
def artifact(run_id: uuid.UUID, kind: str) -> Response:
    fields = {"prompt": "prompt_path", "output": "output_path", "events": "event_path"}
    if kind not in fields:
        raise HTTPException(status_code=404, detail="Unknown artifact.")
    row = fetch_one(f"SELECT {fields[kind]} AS path FROM research_runs WHERE id=%s", (run_id,))
    if not row or not row["path"]:
        raise HTTPException(status_code=404, detail="Artifact is unavailable under the active retention policy.")
    value = read_artifact(row["path"])
    if kind == "prompt":
        return JSONResponse({"text": value})
    return JSONResponse(json.loads(value))


@app.get("/api/portfolio/latest", dependencies=[Depends(dashboard_auth)])
def latest_portfolio() -> Any:
    return jsonable_encoder(latest_strategy_performance())


@app.get("/api/portfolio/history", dependencies=[Depends(dashboard_auth)])
def portfolio_history(hours: int = Query(default=24, ge=1, le=8760)) -> Any:
    return jsonable_encoder(strategy_performance_history(hours))


@app.get("/api/orders", dependencies=[Depends(dashboard_auth)])
def orders(limit: int = Query(default=100, ge=1, le=500)) -> Any:
    return jsonable_encoder(fetch_all("SELECT * FROM orders ORDER BY created_at DESC LIMIT %s", (limit,)))


@app.post("/api/control/kill-switch", dependencies=[Depends(dashboard_auth)])
def kill_switch(body: SwitchRequest) -> dict[str, Any]:
    if not body.engaged:
        raise HTTPException(status_code=400, detail="Use the capability-gated paper-trading enable action to clear the kill switch.")
    set_setting("kill_switch", True, "dashboard")
    set_setting("trading_enabled", False, "dashboard")
    return {"kill_switch": True, "trading_enabled": False}


@app.post("/api/control/enable-paper-trading", dependencies=[Depends(dashboard_auth)])
def enable_paper_trading() -> dict[str, Any]:
    broker = fetch_one("SELECT * FROM broker_status WHERE singleton=true")
    if (
        not broker
        or broker["state"] != "connected"
        or not str(broker.get("account_id") or "").startswith("DU")
        or not broker.get("portfolio_readable")
        or not (broker.get("live_us_stock_quotes") or broker.get("delayed_us_stock_quotes"))
        or not broker.get("api_us_stock_order_access")
    ):
        raise HTTPException(
            status_code=409,
            detail="A readable allowlisted DU paper account, live or owner-authorized delayed US-stock quotes, and successful What-If order probe are required.",
        )
    set_setting("trading_enabled", True, "dashboard")
    set_setting("kill_switch", False, "dashboard")
    return {"kill_switch": False, "trading_enabled": True, "paper_only": True}


@app.post("/api/control/run-now", dependencies=[Depends(dashboard_auth)])
def run_now() -> dict[str, Any]:
    active = fetch_one(
        "SELECT id FROM research_runs WHERE status IN ('queued','snapshotting','researching','validating') LIMIT 1"
    )
    if active:
        raise HTTPException(status_code=409, detail=f"Run {active['id']} is already active or queued.")
    run_id = queue_run(datetime.now(UTC), "manual")
    return {"run_id": run_id, "status": "queued"}


@app.post("/internal/run-event", dependencies=[Depends(internal_auth)])
async def internal_run_event(request: Request) -> dict[str, bool]:
    body = await request.json()
    run_id = str(body.get("run_id", ""))
    if not fetch_one("SELECT id FROM research_runs WHERE id=%s", (run_id,)):
        raise HTTPException(status_code=404, detail="Run not found.")
    details = body.get("details") if isinstance(body.get("details"), dict) else {}
    add_event(run_id, str(body.get("event_type", "codex.progress"))[:100], str(body.get("message", ""))[:4000], details)
    return {"ok": True}


@app.get("/api/events", dependencies=[Depends(dashboard_auth)])
async def events(request: Request, after: int = Query(default=0, ge=0)) -> StreamingResponse:
    async def stream() -> AsyncIterator[str]:
        cursor = after
        while not await request.is_disconnected():
            rows = fetch_all("SELECT * FROM run_events WHERE id>%s ORDER BY id LIMIT 100", (cursor,))
            for row in rows:
                cursor = int(row["id"])
                yield f"id: {cursor}\nevent: run-event\ndata: {json.dumps(jsonable_encoder(row), separators=(',', ':'))}\n\n"
            if not rows:
                yield ": keepalive\n\n"
            await asyncio.sleep(2)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})


@app.get("/internal/validation/verify")
def verify_validation(
    t: str = Query(default=""),
    ibkr_validation: str = Cookie(default=""),
) -> JSONResponse:
    candidate = t or ibkr_validation
    if not candidate or not validation_token_valid(candidate):
        raise HTTPException(status_code=403, detail="Validation session is invalid or expired.")
    return JSONResponse({"valid": True}, status_code=200)


@app.get("/account-validation", response_class=HTMLResponse)
def account_validation(t: str = Query(default="")) -> HTMLResponse:
    if not t or not validation_token_valid(t):
        raise HTTPException(status_code=403, detail="This validation link is invalid or expired.")
    gateway = f"{settings.public_base_url}/gateway/vnc.html?autoconnect=true&resize=scale&path=backend%2Fibkr_codex%2Fgateway%2Fwebsockify"
    response = HTMLResponse(f"""<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'>
    <title>IBKR paper account validation</title><style>body{{font:16px system-ui;background:#071018;color:#edf6ff;max-width:760px;margin:4rem auto;padding:1rem}}a{{color:#61dafb}}.box{{background:#102231;padding:1.4rem;border-radius:14px}}</style></head>
    <body><div class='box'><h1>IBKR paper account validation</h1><p>This link only opens the paper gateway. Confirm the login window says <strong>Paper Trading</strong>, then complete the IBKR login and 2FA.</p>
    <p><a href='{gateway}'>Open the protected IB Gateway console</a></p><p>The scheduler will detect the connected <code>DU…</code> account automatically. Live-account identifiers are rejected.</p></div></body></html>""")
    response.set_cookie(
        "ibkr_validation", t, max_age=7200, httponly=True, secure=True, samesite="strict",
        path="/backend/ibkr_codex",
    )
    return response
