from app.notifications import format_run_report, order_fill_summary


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
