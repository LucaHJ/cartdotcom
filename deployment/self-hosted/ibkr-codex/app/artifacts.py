from __future__ import annotations

import gzip
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.config import settings
from app.database import connection, fetch_all


@dataclass(frozen=True)
class StoredArtifact:
    path: str
    sha256: str
    bytes: int


def _run_dir(run_id: str, now: datetime | None = None) -> Path:
    resolved_root = settings.artifact_root.resolve().as_posix().lower().rstrip("/")
    if (
        settings.pg_database.startswith("ibkr_queue_test_")
        and resolved_root.endswith("/data/artifacts")
    ):
        raise RuntimeError(
            "Disposable queue tests are forbidden from writing to the production /data/artifacts mount. "
            "Set ARTIFACT_ROOT to an isolated temporary directory."
        )
    stamp = now or datetime.now(UTC)
    path = settings.artifact_root / stamp.strftime("%Y/%m") / run_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def store_text(run_id: str, name: str, value: str) -> StoredArtifact:
    payload = value.encode("utf-8")
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)
    path = _run_dir(run_id) / f"{name}.txt.gz"
    path.write_bytes(compressed)
    return StoredArtifact(str(path), hashlib.sha256(payload).hexdigest(), len(compressed))


def store_json(run_id: str, name: str, value: Any) -> StoredArtifact:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)
    path = _run_dir(run_id) / f"{name}.json.gz"
    path.write_bytes(compressed)
    return StoredArtifact(str(path), hashlib.sha256(payload).hexdigest(), len(compressed))


def read_artifact(path: str) -> str:
    return gzip.decompress(Path(path).read_bytes()).decode("utf-8")


def retention_status() -> dict[str, Any]:
    rows = fetch_all(
        "SELECT created_at, artifact_bytes FROM research_runs "
        "WHERE created_at >= now() - interval '30 days' AND artifact_bytes > 0"
    )
    observed = sum(int(row["artifact_bytes"]) for row in rows)
    if not rows:
        projected = 0
    else:
        oldest = min(row["created_at"] for row in rows)
        days = max(1.0, (datetime.now(UTC) - oldest).total_seconds() / 86400)
        projected = round(observed / days * 365)
    return {
        "observed_bytes": observed,
        "observed_runs": len(rows),
        "projected_annual_bytes": projected,
        "annual_limit_bytes": settings.retention_annual_limit_bytes,
        "policy": "one_year" if projected > settings.retention_annual_limit_bytes else "indefinite",
    }


def enforce_retention() -> int:
    status = retention_status()
    if status["policy"] != "one_year":
        return 0
    cutoff = datetime.now(UTC) - timedelta(days=365)
    rows = fetch_all(
        "SELECT id,prompt_path,output_path,event_path,runner_result_path FROM research_runs "
        "WHERE created_at < %s AND artifact_bytes > 0",
        (cutoff,),
    )
    removed = 0
    for row in rows:
        for field in ("prompt_path", "output_path", "event_path", "runner_result_path"):
            path = row.get(field)
            if path:
                candidate = Path(path).resolve()
                root = settings.artifact_root.resolve()
                if root in candidate.parents and candidate.exists():
                    candidate.unlink()
                    removed += 1
        with connection() as conn:
            conn.execute(
                "UPDATE research_runs SET prompt_path=NULL,output_path=NULL,event_path=NULL,runner_result_path=NULL,artifact_bytes=0 "
                "WHERE id=%s",
                (row["id"],),
            )
            conn.commit()
    return removed
