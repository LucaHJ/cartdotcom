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


def next_execution_window(now: datetime | None = None) -> datetime:
    """Return now during a usable session, otherwise the next NYSE open."""
    now = now or datetime.now(UTC)
    if execution_window_sufficient(1, now):
        return now
    local = now.astimezone(ET)
    schedule = mcal.get_calendar("NYSE").schedule(
        start_date=local.date(), end_date=local.date() + timedelta(days=30))
    for opening in schedule["market_open"]:
        candidate = opening.to_pydatetime()
        if candidate > now:
            return candidate
    raise RuntimeError("No upcoming NYSE execution window was found.")


def decision_expiry(now: datetime) -> datetime:
    """Expire five minutes before the next scheduled research session.

    This keeps an independently queued signal available across closed sessions,
    weekends and holidays, while ensuring stale research cannot overlap the next
    scheduled portfolio review.
    """
    local = now.astimezone(ET)
    schedule = mcal.get_calendar("NYSE").schedule(
        start_date=local.date(), end_date=local.date() + timedelta(days=30))
    for row in schedule.itertuples():
        opening = row.market_open.to_pydatetime()
        closing = row.market_close.to_pydatetime()
        cutoff = opening + (closing - opening) / 2 - timedelta(minutes=5)
        if cutoff > now:
            return cutoff
    raise RuntimeError("No upcoming scheduled research session was found for signal expiry.")
