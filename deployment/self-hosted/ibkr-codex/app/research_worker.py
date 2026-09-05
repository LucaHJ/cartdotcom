"""Schedule and perform research without opening any IBKR connection."""
import logging
import time
from datetime import UTC, datetime

from app.database import connection, fetch_one, migrate
from app.notifications import send_market_closed_report
from app.performance import latest_strategy_performance
from app.workflow import execute_run, queue_run
from app.schedule import daily_checkpoint_time, research_day_status, scheduled_time

log = logging.getLogger("ibkr-research")
_last_closed_report_attempt: dict[str, float] = {}


def queue_scheduled_research(now: datetime) -> None:
    day = research_day_status(now)
    checkpoint = daily_checkpoint_time(now)
    if now < checkpoint:
        return
    if day["skip_research"]:
        local_date = str(day["local_date"])
        existing = fetch_one(
            "SELECT status FROM notifications WHERE dedupe_key=%s",
            (f"market-closed-report:{local_date}",),
        )
        if existing and existing["status"] == "sent":
            return
        last_attempt = _last_closed_report_attempt.get(local_date, 0)
        if time.monotonic() - last_attempt < 300:
            return
        _last_closed_report_attempt[local_date] = time.monotonic()
        send_market_closed_report(day, latest_strategy_performance())
        return
    due = scheduled_time(now)
    # Catch up after a restart on the same NY trading date, even if IBKR is down.
    if due:
        existing = fetch_one(
            "SELECT id FROM research_runs WHERE trigger='schedule' "
            "AND (scheduled_for AT TIME ZONE 'America/New_York')::date="
            "(%s AT TIME ZONE 'America/New_York')::date", (due,))
        if not existing:
            queue_run(due, "schedule")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    migrate()
    with connection() as lease:
        lock = lease.execute("SELECT pg_try_advisory_lock(491720260902) AS acquired").fetchone()
        lease.commit()
        if not lock["acquired"]:
            raise RuntimeError("Another research worker is running.")
        # Preserve completed artifacts and never change the trading kill switch.
        lease.execute(
            "UPDATE research_runs SET status='queued',error='Research worker restarted; retrying.' "
            "WHERE status IN ('snapshotting','researching','validating')")
        lease.commit()
        while True:
            try:
                queue_scheduled_research(datetime.now(UTC))
                row = fetch_one("SELECT id FROM research_runs WHERE status='queued' ORDER BY created_at LIMIT 1")
                if row:
                    execute_run(str(row["id"]))
            except Exception:
                log.exception("Research worker cycle failed; broker execution is independent")
            time.sleep(15)


if __name__ == "__main__":
    main()
