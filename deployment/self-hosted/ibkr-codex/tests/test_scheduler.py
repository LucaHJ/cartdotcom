from datetime import UTC, datetime
from unittest.mock import patch

from app import research_worker
from app.worker import performance_archive_hour, scheduled_time
from app.schedule import daily_checkpoint_time, decision_expiry, execution_window_sufficient, next_execution_window, research_day_status


def test_schedule_is_1245_new_york_on_regular_market_day() -> None:
    due = scheduled_time(datetime(2026, 9, 1, 17, 0, tzinfo=UTC))
    assert due == datetime(2026, 9, 1, 16, 45, tzinfo=UTC)


def test_schedule_skips_nyse_holiday() -> None:
    assert scheduled_time(datetime(2026, 9, 7, 17, 0, tzinfo=UTC)) is None


def test_calendar_identifies_weekend_and_still_has_daily_checkpoint() -> None:
    now = datetime(2026, 9, 5, 18, 0, tzinfo=UTC)
    status = research_day_status(now)
    assert status["day_of_week"] == "Saturday"
    assert status["skip_research"] is True
    assert "Weekend" in str(status["reason"])
    assert daily_checkpoint_time(now) == datetime(2026, 9, 5, 16, 45, tzinfo=UTC)


def test_calendar_skips_federal_holiday_even_when_nyse_is_open() -> None:
    status = research_day_status(datetime(2026, 10, 12, 17, 0, tzinfo=UTC))
    assert status["nyse_open"] is True
    assert status["skip_research"] is True
    assert "Columbus Day" in str(status["reason"])


def test_schedule_uses_actual_midpoint_on_early_close() -> None:
    due = scheduled_time(datetime(2026, 11, 27, 16, 0, tzinfo=UTC))
    assert due == datetime(2026, 11, 27, 16, 15, tzinfo=UTC)


def test_calendar_reports_current_new_york_time_and_market_phase() -> None:
    pre_open = research_day_status(datetime(2026, 9, 4, 12, 0, tzinfo=UTC))
    market_open = research_day_status(datetime(2026, 9, 4, 15, 0, tzinfo=UTC))
    post_close = research_day_status(datetime(2026, 9, 5, 2, 22, tzinfo=UTC))

    assert pre_open["market_status"] == "Pre open"
    assert market_open["market_status"] == "Market open"
    assert post_close["market_status"] == "Post close"
    assert str(post_close["current_time_ny"]).startswith("2026-09-04T22:22:00")
    assert str(post_close["market_open_ny"]).startswith("2026-09-04T09:30:00")
    assert str(post_close["market_close_ny"]).startswith("2026-09-04T16:00:00")


def test_performance_archive_uses_utc_wall_clock_hour() -> None:
    captured = datetime(2026, 9, 5, 3, 47, 59, 999999, tzinfo=UTC)
    assert performance_archive_hour(captured) == datetime(2026, 9, 5, 3, tzinfo=UTC)


def test_orders_are_not_allowed_before_open_or_near_close():
    assert not execution_window_sufficient(1, datetime(2026, 9, 3, 13, 0, tzinfo=UTC))
    assert execution_window_sufficient(1, datetime(2026, 9, 3, 13, 30, tzinfo=UTC))
    assert not execution_window_sufficient(1, datetime(2026, 9, 3, 19, 50, tzinfo=UTC))


def test_after_hours_expiry_is_before_next_research_and_skips_weekend_and_holiday():
    assert decision_expiry(datetime(2026, 9, 4, 21, 0, tzinfo=UTC)) == datetime(2026, 9, 8, 16, 40, tzinfo=UTC)


def test_expiry_uses_actual_early_close_research_midpoint():
    assert decision_expiry(datetime(2026, 11, 26, 18, 0, tzinfo=UTC)) == datetime(2026, 11, 27, 16, 10, tzinfo=UTC)


def test_closed_market_queue_sleeps_until_next_open_across_holiday():
    assert next_execution_window(datetime(2026, 9, 4, 21, 0, tzinfo=UTC)) == datetime(2026, 9, 8, 13, 30, tzinfo=UTC)


def test_weekend_checkpoint_emails_report_without_queuing_codex() -> None:
    research_worker._last_closed_report_attempt.clear()
    now = datetime(2026, 9, 5, 17, 0, tzinfo=UTC)
    with (
        patch.object(research_worker, "fetch_one", return_value=None),
        patch.object(research_worker, "latest_strategy_performance", return_value={"available": False}),
        patch.object(research_worker, "send_market_closed_report", return_value=True) as email,
        patch.object(research_worker, "queue_run") as queue,
    ):
        research_worker.queue_scheduled_research(now)

    email.assert_called_once()
    queue.assert_not_called()
