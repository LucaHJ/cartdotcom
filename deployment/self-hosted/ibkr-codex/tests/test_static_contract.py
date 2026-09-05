from pathlib import Path


def test_dashboard_discloses_safety_boundary_and_limits() -> None:
    value = (Path(__file__).parents[1] / "static" / "index.html").read_text(encoding="utf-8")
    assert "PAPER ONLY" in value
    assert "Hard risk limits" in value
    assert "Engage kill switch" in value
    assert "Delayed US quotes permitted" in value
    assert "backend/ibkr_codex" in value
    assert "International target" in value
    assert "Power / grid target" in value
    assert "Execution FX" in value
    assert "$20,000 strategy-slice performance · updated hourly" in value
    assert "Hourly performance archive" in value
    assert "Research calendar" in value
    assert "Current New York time" in value
    assert "Market open" in value
    assert "archive-year" in value
    assert "Current cash AUD" in value
    assert "USD → AUD rate" in value
    assert "Net liquidation" not in value


def test_compose_fixes_gateway_to_paper_port() -> None:
    value = (Path(__file__).parents[1] / "compose.yaml").read_text(encoding="utf-8")
    assert 'IBKR_PORT: "4002"' in value
    assert "IBKR_PAPER_ACCOUNT_FILE" in value
    assert "ib-gateway" in value


def test_fastapi_routes_can_be_constructed() -> None:
    from app.main import app

    assert any(route.path == "/api/control/kill-switch" for route in app.routes)
    assert any(route.path == "/api/calendar" for route in app.routes)
    assert any(route.path == "/api/portfolio/history/index" for route in app.routes)
    assert any(route.path == "/api/portfolio/history/record" for route in app.routes)
