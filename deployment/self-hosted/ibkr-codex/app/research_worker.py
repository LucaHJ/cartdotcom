"""Schedule and perform research without opening any IBKR connection."""
import logging
import time
from datetime import UTC, datetime

from app.database import connection, fetch_one, migrate
from app.workflow import execute_run, queue_run
from app.schedule import scheduled_time

log = logging.getLogger("ibkr-research")


def queue_scheduled_research(now: datetime) -> None:
    due = scheduled_time(now)
    # Catch up after a restart on the same NY trading date, even if IBKR is down.
    if due and now >= due:
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
