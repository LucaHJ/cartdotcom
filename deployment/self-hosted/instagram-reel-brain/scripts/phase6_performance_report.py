#!/usr/bin/env python3
"""Compare recent serial Phase 6 timings with concurrency-two observations."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any

DEFAULT_LOG = Path("/srv/cartdotcom/instagram-reel-brain/runs/phase6-performance.jsonl")
DEFAULT_MARKER = Path("/srv/cartdotcom/instagram-reel-brain/runs/phase6-concurrency2/start.json")
DEFAULT_OUTPUT = Path("/srv/cartdotcom/instagram-reel-brain/runs/phase6-concurrency2/latest.json")


def parse_time(value: Any) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00").replace(" ", "T"))
    except (TypeError, ValueError):
        return None


def load_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
            if isinstance(row, dict) and isinstance(row.get("processor_timings"), dict):
                rows.append(row)
        except json.JSONDecodeError:
            continue
    return rows


def number(row: dict[str, Any], key: str) -> float | None:
    timings = row.get("processor_timings") or {}
    value = row.get(key) if key in row else timings.get(key)
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    metrics = {
        "queue_wait_seconds": "queue_wait_seconds",
        "orchestration_seconds": "orchestration_seconds",
        "control_handover_seconds": "control_handover_seconds",
        "processor_total_seconds": "total_seconds",
        "download_seconds": "download_seconds",
        "media_preparation_seconds": "media_preparation_seconds",
        "codex_seconds": "codex_seconds",
        "completion_seconds": "completion_seconds",
    }
    result: dict[str, Any] = {"count": len(rows)}
    for output_key, source_key in metrics.items():
        values = [value for row in rows if (value := number(row, source_key)) is not None]
        result[f"average_{output_key}"] = round(mean(values), 3) if values else None
    result["prefetch_hit_rate"] = round(mean([1.0 if (row.get("processor_timings") or {}).get("prefetch_hit") else 0.0 for row in rows]), 3) if rows else None
    intervals = []
    for row in rows:
        start = parse_time(row.get("dispatch_started_at"))
        elapsed = number(row, "orchestration_seconds")
        if start is None:
            end = parse_time(row.get("recorded_at"))
            start = end and elapsed is not None and datetime.fromtimestamp(end.timestamp() - elapsed, tz=end.tzinfo)
        if start and elapsed is not None:
            intervals.append((start.timestamp(), start.timestamp() + elapsed))
    points = sorted([(start, 1) for start, _ in intervals] + [(end, -1) for _, end in intervals], key=lambda point: (point[0], point[1]))
    active = peak = 0
    for _, delta in points:
        active += delta
        peak = max(peak, active)
    result["peak_overlap"] = peak
    if intervals:
        span = max(end for _, end in intervals) - min(start for start, _ in intervals)
        result["observed_jobs_per_hour"] = round(len(intervals) * 3600 / span, 3) if span > 0 else None
    else:
        result["observed_jobs_per_hour"] = None
    return result


def write_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    os.chmod(temp, 0o600)
    temp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--marker", type=Path, default=DEFAULT_MARKER)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    marker = json.loads(args.marker.read_text(encoding="utf-8"))
    started_at = parse_time(marker["started_at"])
    if started_at is None:
        raise SystemExit("invalid concurrency-two marker")
    rows = load_rows(args.log)
    before = [row for row in rows if (parse_time(row.get("recorded_at")) or started_at) < started_at][-8:]
    after = [row for row in rows if (parse_time(row.get("recorded_at")) or started_at) >= started_at]
    baseline, current = summarise(before), summarise(after)
    deltas = {}
    for key, old in baseline.items():
        new = current.get(key)
        if key.startswith("average_") and isinstance(old, (int, float)) and old and isinstance(new, (int, float)):
            deltas[f"{key}_percent"] = round((new - old) * 100 / old, 2)
    payload = {"started_at": marker["started_at"], "baseline": baseline, "concurrency_two": current, "deltas": deltas}
    write_atomic(args.output, payload)
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
