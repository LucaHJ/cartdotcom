from app.notifications import format_run_report


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
    assert "SPY BUY" in report
    assert "filled 1 / remaining 0" in report
    assert "Dashboard:" in report
