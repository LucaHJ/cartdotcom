from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pandas_market_calendars as mcal

ET = ZoneInfo("America/New_York")


def scheduled_time(now: datetime) -> datetime | None:
    local = now.astimezone(ET)
    schedule = mcal.get_calendar("NYSE").schedule(start_date=local.date(), end_date=local.date())
    if schedule.empty:
        return None
    opening = schedule.iloc[0]["market_open"].to_pydatetime()
    closing = schedule.iloc[0]["market_close"].to_pydatetime()
    return opening + (closing - opening) / 2


def execution_window_sufficient(count: int, now: datetime | None = None) -> bool:
    from app.policy import POLICY
    now = now or datetime.now(UTC)
    local = now.astimezone(ET)
    schedule = mcal.get_calendar("NYSE").schedule(start_date=local.date(), end_date=local.date())
    if schedule.empty:
        return False
    opening = schedule.iloc[0]["market_open"].to_pydatetime()
    closing = schedule.iloc[0]["market_close"].to_pydatetime()
    return opening <= now and now + timedelta(seconds=count * POLICY.max_attempts * POLICY.attempt_seconds + 120) <= closing


def decision_expiry(now: datetime) -> datetime:
    """Use this session's close, or the next trading close for after-hours research."""
    local = now.astimezone(ET)
    schedule = mcal.get_calendar("NYSE").schedule(
        start_date=local.date(), end_date=local.date() + timedelta(days=14))
    for closing in schedule["market_close"]:
        if closing.to_pydatetime() > now:
            return closing.to_pydatetime()
    raise RuntimeError("No upcoming NYSE session was found for signal expiry.")
