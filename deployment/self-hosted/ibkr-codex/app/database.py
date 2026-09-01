from __future__ import annotations

import json
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import settings


pool = ConnectionPool(conninfo=settings.dsn, min_size=1, max_size=8, kwargs={"row_factory": dict_row}, open=False)


def open_pool() -> None:
    if pool.closed:
        pool.open(wait=True)


def close_pool() -> None:
    if not pool.closed:
        pool.close()


def migrate() -> None:
    open_pool()
    root = Path(__file__).resolve().parent.parent / "migrations"
    with pool.connection() as conn:
        for path in sorted(root.glob("*.sql")):
            conn.execute(path.read_text(encoding="utf-8"), prepare=False)
        conn.commit()


@contextmanager
def connection() -> Iterator[Any]:
    open_pool()
    with pool.connection() as conn:
        yield conn


def fetch_one(query: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    with connection() as conn:
        return conn.execute(query, params).fetchone()


def fetch_all(query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connection() as conn:
        return list(conn.execute(query, params).fetchall())


def execute(query: str, params: tuple[Any, ...] = ()) -> None:
    with connection() as conn:
        conn.execute(query, params)
        conn.commit()


def setting_bool(key: str, default: bool = False) -> bool:
    row = fetch_one("SELECT value FROM app_settings WHERE key=%s", (key,))
    return bool(row["value"]) if row else default


def set_setting(key: str, value: Any, actor: str) -> None:
    with connection() as conn:
        conn.execute(
            "INSERT INTO app_settings(key,value) VALUES(%s,%s::jsonb) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=now()",
            (key, json.dumps(value)),
        )
        conn.execute(
            "INSERT INTO audit_log(actor,action,details) VALUES(%s,%s,%s::jsonb)",
            (actor, f"setting.{key}", json.dumps({"value": value})),
        )
        conn.commit()


def add_event(run_id: str, event_type: str, message: str, details: dict[str, Any] | None = None) -> None:
    execute(
        "INSERT INTO run_events(run_id,event_type,message,details) VALUES(%s,%s,%s,%s::jsonb)",
        (run_id, event_type, message, json.dumps(details or {})),
    )

