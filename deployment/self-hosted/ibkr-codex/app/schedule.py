from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pandas_market_calendars as mcal
from pandas.tseries.holiday import USFederalHolidayCalendar

from app.config import settings

ET = ZoneInfo("America/New_York")
NYSE = mcal.get_calendar("NYSE")
US_HOLIDAYS = USFederalHolidayCalendar()


def _holiday_names(local_date: date) -> list[str]:
    names: list[str] = []
    federal = US_HOLIDAYS.holidays(start=local_date, end=local_date, return_name=True)
    regular = NYSE.regular_holidays.holidays(start=local_date, end=local_date, return_name=True)
    for value in [*federal.tolist(), *regular.tolist()]:
        name = str(value)
        if name not in names:
            names.append(name)
    return names


def research_day_status(now: datetime) -> dict[str, object]:
    """Describe the US research date and whether Codex should be launched."""
    local = now.astimezone(ET)
    local_date = local.date()
    schedule = NYSE.schedule(start_date=local_date, end_date=local_date)
    holidays = _holiday_names(local_date)
    weekend = local.weekday() >= 5
    nyse_open = not schedule.empty
    opening = schedule.iloc[0]["market_open"].to_pydatetime() if nyse_open else None
    closing = schedule.iloc[0]["market_close"].to_pydatetime() if nyse_open else None
    if not nyse_open:
        market_status = "Market closed"
    elif now < opening:
        market_status = "Pre open"
    elif now < closing:
        market_status = "Market open"
    else:
        market_status = "Post close"
    skip = weekend or bool(holidays) or not nyse_open
    reasons: list[str] = []
    if weekend:
        reasons.append(f"Weekend ({local.strftime('%A')})")
    if holidays:
        reasons.append("Public/market holiday: " + ", ".join(holidays))
    if not nyse_open and not weekend and not holidays:
        reasons.append("NYSE market holiday or special closure")
    return {
        "local_date": local_date.isoformat(),
        "day_of_week": local.strftime("%A"),
        "timezone": "America/New_York",
        "public_holidays": holidays,
        "nyse_open": nyse_open,
        "market_status": market_status,
        "current_time_ny": local.isoformat(),
        "market_open_ny": opening.astimezone(ET).isoformat() if opening else None,
        "market_close_ny": closing.astimezone(ET).isoformat() if closing else None,
        "skip_research": skip,
        "reason": "; ".join(reasons) if reasons else "Regular NYSE trading day",
    }


def daily_checkpoint_time(now: datetime) -> datetime:
    """Use the market midpoint, or the regular 12:45 ET checkpoint when closed."""
    local = now.astimezone(ET)
    schedule = NYSE.schedule(start_date=local.date(), end_date=local.date())
    if not schedule.empty:
        opening = schedule.iloc[0]["market_open"].to_pydatetime()
        closing = schedule.iloc[0]["market_close"].to_pydatetime()
        return opening + (closing - opening) / 2
    hour, minute = (int(part) for part in settings.trading_time_et.split(":", 1))
    return datetime.combine(local.date(), time(hour, minute), tzinfo=ET)


def scheduled_time(now: datetime) -> datetime | None:
    status = research_day_status(now)
    if status["skip_research"]:
        return None
    return daily_checkpoint_time(now)


def execution_window_sufficient(count: int, now: datetime | None = None) -> bool:
    from app.policy import POLICY
    now = now or datetime.now(UTC)
    local = now.astimezone(ET)
    schedule = NYSE.schedule(start_date=local.date(), end_date=local.date())
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
    schedule = NYSE.schedule(
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
    schedule = NYSE.schedule(
        start_date=local.date(), end_date=local.date() + timedelta(days=30))
    for row in schedule.itertuples():
        opening = row.market_open.to_pydatetime()
        closing = row.market_close.to_pydatetime()
        if _holiday_names(opening.astimezone(ET).date()):
            continue
        cutoff = opening + (closing - opening) / 2 - timedelta(minutes=5)
        if cutoff > now:
            return cutoff
    raise RuntimeError("No upcoming scheduled research session was found for signal expiry.")
