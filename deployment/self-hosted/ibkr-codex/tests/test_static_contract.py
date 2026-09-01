from pathlib import Path


def test_dashboard_discloses_safety_boundary_and_limits() -> None:
    value = (Path(__file__).parents[1] / "static" / "index.html").read_text(encoding="utf-8")
    assert "PAPER ONLY" in value
    assert "Hard risk limits" in value
    assert "Engage kill switch" in value
    assert "backend/ibkr_codex" in value


def test_compose_fixes_gateway_to_paper_port() -> None:
    value = (Path(__file__).parents[1] / "compose.yaml").read_text(encoding="utf-8")
    assert 'IBKR_PORT: "4002"' in value
    assert "IBKR_PAPER_ACCOUNT_FILE" in value
    assert "ib-gateway" in value


def test_fastapi_routes_can_be_constructed() -> None:
    from app.main import app

    assert any(route.path == "/api/control/kill-switch" for route in app.routes)
