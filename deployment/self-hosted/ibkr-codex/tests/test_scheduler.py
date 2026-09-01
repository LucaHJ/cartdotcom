from datetime import UTC, datetime

from app.worker import scheduled_time


def test_schedule_is_1245_new_york_on_regular_market_day() -> None:
    due = scheduled_time(datetime(2026, 9, 1, 17, 0, tzinfo=UTC))
    assert due == datetime(2026, 9, 1, 16, 45, tzinfo=UTC)


def test_schedule_skips_nyse_holiday() -> None:
    assert scheduled_time(datetime(2026, 9, 7, 17, 0, tzinfo=UTC)) is None


def test_schedule_uses_actual_midpoint_on_early_close() -> None:
    due = scheduled_time(datetime(2026, 11, 27, 16, 0, tzinfo=UTC))
    assert due == datetime(2026, 11, 27, 16, 15, tzinfo=UTC)
