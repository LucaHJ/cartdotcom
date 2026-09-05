from datetime import UTC, datetime

from app.worker import scheduled_time
from app.schedule import execution_window_sufficient, decision_expiry


def test_schedule_is_1245_new_york_on_regular_market_day() -> None:
    due = scheduled_time(datetime(2026, 9, 1, 17, 0, tzinfo=UTC))
    assert due == datetime(2026, 9, 1, 16, 45, tzinfo=UTC)


def test_schedule_skips_nyse_holiday() -> None:
    assert scheduled_time(datetime(2026, 9, 7, 17, 0, tzinfo=UTC)) is None


def test_schedule_uses_actual_midpoint_on_early_close() -> None:
    due = scheduled_time(datetime(2026, 11, 27, 16, 0, tzinfo=UTC))
    assert due == datetime(2026, 11, 27, 16, 15, tzinfo=UTC)


def test_orders_are_not_allowed_before_open_or_near_close():
    assert not execution_window_sufficient(1, datetime(2026, 9, 3, 13, 0, tzinfo=UTC))
    assert execution_window_sufficient(1, datetime(2026, 9, 3, 13, 30, tzinfo=UTC))
    assert not execution_window_sufficient(1, datetime(2026, 9, 3, 19, 50, tzinfo=UTC))


def test_after_hours_expiry_is_before_next_research_and_skips_weekend_and_holiday():
    assert decision_expiry(datetime(2026, 9, 4, 21, 0, tzinfo=UTC)) == datetime(2026, 9, 8, 16, 40, tzinfo=UTC)


def test_expiry_uses_actual_early_close_research_midpoint():
    assert decision_expiry(datetime(2026, 11, 26, 18, 0, tzinfo=UTC)) == datetime(2026, 11, 27, 16, 10, tzinfo=UTC)
