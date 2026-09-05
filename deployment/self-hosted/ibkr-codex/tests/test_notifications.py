from app.notifications import format_market_closed_report, format_run_report, order_fill_summary


def test_run_report_includes_research_and_paper_actions() -> None:
    report = format_run_report(
        {
            "id": "run-1", "status": "completed", "trigger": "schedule", "runtime_seconds": 12,
            "codex_runtime_seconds": 9, "input_tokens": 100, "output_tokens": 200,
            "cached_input_tokens": 50, "decision_summary": "Maintain quality exposure; add a small position.",
        },
        [{
            "symbol": "SPY", "action": "BUY", "target_weight_pct": "5", "confidence": "0.8",
            "validation_status": "accepted", "thesis": "Broad market exposure is appropriate.",
            "validation_message": None,
        }],
        [{
            "symbol": "SPY", "side": "BUY", "requested_quantity": "1", "limit_price": "500",
            "attempt": 1, "status": "Filled", "filled_quantity": "1", "remaining_quantity": "0", "error": None,
        }],
        [{"symbol": "SPY", "side": "BUY", "shares": "1", "price": "500"}],
    )

    assert "Maintain quality exposure" in report
    assert report.startswith("ORDER FILL STATUS: PENDING")
    assert "SPY BUY" in report
    assert "filled 1 / remaining 0" in report
    assert "Dashboard:" in report


def test_fill_status_is_first_and_distinguishes_terminal_outcomes() -> None:
    decisions = [{"action": "BUY", "validation_status": "unfilled"}]
    orders = [{"requested_quantity": "4", "filled_quantity": "1"}]

    result = order_fill_summary("completed", decisions, orders)

    assert result["outcome"] == "unfilled"
    assert str(result["headline"]).startswith("ORDER FILL STATUS: PARTIALLY FILLED")


def test_fill_status_says_when_nothing_reached_the_broker() -> None:
    result = order_fill_summary(
        "expired",
        [{"action": "BUY", "validation_status": "queued"}],
        [],
    )

    assert result["headline"] == (
        "ORDER FILL STATUS: NOT FILLED — 0/1 decisions satisfied; no broker orders were submitted"
    )


def test_fill_status_recognises_recovered_execution() -> None:
    decisions = [
        {"action": "BUY", "validation_status": "executed"},
        {"action": "BUY", "validation_status": "accepted_no_order"},
        {"action": "HOLD", "validation_status": "accepted_no_order"},
    ]
    orders = [{"requested_quantity": "4", "filled_quantity": "4"}]

    result = order_fill_summary("completed", decisions, orders)

    assert result["outcome"] == "filled"
    assert result["headline"] == "ORDER FILL STATUS: FILLED — 2/2 decisions satisfied; 4/4 submitted shares filled"


def test_market_closed_report_starts_with_status_and_strategy_performance() -> None:
    report = format_market_closed_report(
        {
            "day_of_week": "Monday",
            "local_date": "2026-09-07",
            "timezone": "America/New_York",
            "reason": "Public/market holiday: Labor Day",
        },
        {
            "available": True,
            "complete": True,
            "currency": "AUD",
            "initial_budget": "20000",
            "strategy_value": "20100",
            "total_return": "100",
            "total_return_pct": "0.5",
            "strategy_cash": "8000",
            "invested_value": "12100",
            "positions": [{
                "symbol": "SCHB", "quantity": "100", "last_usd": "60", "market_value_usd": "6000",
                "unrealized_pnl_usd": "200", "total_return_pct": "3.45", "latest_day_change_pct": "0.4",
                "performance_status": "ok",
            }],
            "price_sources": ["Yahoo Finance chart API"],
            "prices_observed_through": "2026-09-04T13:30:00+00:00",
            "captured_at": "2026-09-07T16:45:00+00:00",
        },
    )

    assert report.startswith("ORDER FILL STATUS: NO RESEARCH OR ORDERS SCHEDULED")
    assert "Labor Day" in report
    assert "Initial budget: AUD 20,000.00" in report
    assert "SCHB" in report
