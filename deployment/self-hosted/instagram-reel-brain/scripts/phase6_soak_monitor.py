#!/usr/bin/env python3
"""Bounded Phase 6 soak sampler and final gate evaluator."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path("/srv/cartdotcom/instagram-reel-brain")
RUN_ROOT = ROOT / "runs" / "phase6-soak"
STATE_PATH = RUN_ROOT / "state.json"
SAMPLES_PATH = RUN_ROOT / "samples.jsonl"
LATEST_PATH = RUN_ROOT / "latest.json"
HEALTH_URL = "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev/health"
SCHEMA = "reel_phase4_shadow_20260821_014246"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2, sort_keys=True, default=str), encoding="utf-8")
    os.chmod(temp, 0o600)
    temp.replace(path)


def append_sample(payload: dict[str, Any]) -> None:
    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    os.chmod(RUN_ROOT, 0o700)
    with SAMPLES_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True, default=str) + "\n")
    os.chmod(SAMPLES_PATH, 0o600)
    atomic_json(LATEST_PATH, payload)


def command(args: list[str], timeout: int = 90) -> str:
    result = subprocess.run(args, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"command failed rc={result.returncode}: {(result.stderr or result.stdout)[-1200:]}")
    return result.stdout


def parse_object(text: str) -> dict[str, Any]:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("expected JSON object output")
    payload = json.loads(text[start:end + 1])
    if not isinstance(payload, dict):
        raise RuntimeError("expected JSON object")
    return payload


def worker_health() -> dict[str, Any]:
    request = urllib.request.Request(HEALTH_URL, headers={"User-Agent": "cartdotcom-phase6-soak/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload if isinstance(payload, dict) else {}


def authority_state(generation: int) -> dict[str, Any]:
    return parse_object(command([
        "python3", str(ROOT / "scripts" / "phase6_authority.py"), "state", "--generation", str(generation),
    ], timeout=180))


def pg_state() -> dict[str, Any]:
    sql = f"""
      SELECT json_build_object(
        'mode',pa.mode,'generation',pa.generation,'watermark',pa.cutover_watermark,
        'backlog_enabled',pa.backlog_enabled,
        'row_versions',(SELECT count(*) FROM {SCHEMA}.phase4_mirror_row_versions),
        'object_receipts',(SELECT count(*) FROM {SCHEMA}.phase4_mirror_object_receipts),
        'divergences',(SELECT count(*) FROM {SCHEMA}.phase4_mirror_divergences),
        'mirror_errors',(SELECT count(*) FROM {SCHEMA}.phase4_mirror_errors),
        'active_leases',(SELECT count(*) FROM {SCHEMA}.phase5_pilot_leases WHERE status IN ('armed','leased','processing')),
        'processing_leases',(SELECT count(*) FROM {SCHEMA}.phase5_pilot_leases WHERE status='processing'),
        'stale_leases',(SELECT count(*) FROM {SCHEMA}.phase5_pilot_leases WHERE status IN ('armed','leased','processing') AND lease_expires_at<now()),
        'jobs_since_watermark',(SELECT count(*) FROM {SCHEMA}.jobs WHERE created_at>=pa.cutover_watermark),
        'complete_since_watermark',(SELECT count(*) FROM {SCHEMA}.jobs WHERE created_at>=pa.cutover_watermark AND status='complete'),
        'queued_since_watermark',(SELECT count(*) FROM {SCHEMA}.jobs WHERE created_at>=pa.cutover_watermark AND status='queued'),
        'running_since_watermark',(SELECT count(*) FROM {SCHEMA}.jobs WHERE created_at>=pa.cutover_watermark AND status='running'),
        'failed_since_watermark',(SELECT count(*) FROM {SCHEMA}.jobs WHERE created_at>=pa.cutover_watermark AND status='failed'),
        'duplicate_completion_jobs',(SELECT count(*) FROM (SELECT e.job_id FROM {SCHEMA}.job_events e JOIN {SCHEMA}.jobs j ON j.id=e.job_id WHERE j.created_at>=pa.cutover_watermark AND e.stage='complete' GROUP BY e.job_id HAVING count(*)>1) d),
        'publication_drift',(SELECT count(*) FROM {SCHEMA}.jobs WHERE created_at>=pa.cutover_watermark AND status='complete' AND (html_key IS NULL OR library_path IS NULL))
      ) FROM {SCHEMA}.processing_authority pa WHERE pa.authority_key='instagram-reel-brain';
    """
    return json.loads(command([
        "docker", "exec", "cartdotcom-platform-postgres-1", "psql", "-U", "cartdotcom", "-d", "cartdotcom", "-q", "-t", "-A", "-c", sql,
    ]).strip())


def docker_state() -> dict[str, Any]:
    rows = []
    names = command(["docker", "ps", "--format", "{{.Names}}"], timeout=30).splitlines()
    selected = [name for name in names if name.startswith(("cartdotcom-instagram-reel-brain-", "cartdotcom-news-", "cartdotcom-platform-caddy", "cartdotcom-platform-postgres"))]
    unhealthy = []
    for name in selected:
        state = json.loads(command(["docker", "inspect", name, "--format", "{{json .State}}"], timeout=30))
        health = (state.get("Health") or {}).get("Status")
        row = {"name": name, "status": state.get("Status"), "health": health}
        rows.append(row)
        if state.get("Status") != "running" or health not in (None, "healthy"):
            unhealthy.append(row)
    return {"count": len(rows), "unhealthy": unhealthy}


def dispatcher_state(generation: int) -> dict[str, Any]:
    pid_path = ROOT / "runs" / "phase6-dispatcher.pid"
    if not pid_path.exists():
        return {"ok": False, "error": "pid_missing"}
    pid = int(pid_path.read_text(encoding="utf-8").strip())
    cmdline_path = Path(f"/proc/{pid}/cmdline")
    if not cmdline_path.exists():
        return {"ok": False, "pid": pid, "error": "process_missing"}
    cmdline = cmdline_path.read_bytes().replace(b"\0", b" ").decode("utf-8", errors="replace")
    expected = f"phase6_dispatcher.py --generation {generation}"
    return {"ok": expected in cmdline, "pid": pid, "command_matches": expected in cmdline}


def sample(generation: int) -> dict[str, Any]:
    failures: list[str] = []
    try:
        health = worker_health()
        authority = authority_state(generation)
        pg = pg_state()
        docker = docker_state()
        dispatcher = dispatcher_state(generation)
        cloud_authority = authority.get("authority") if isinstance(authority.get("authority"), dict) else {}
        active = authority.get("active") if isinstance(authority.get("active"), dict) else {}
        if health.get("ok") is not True or health.get("processing_authority") != "self_hosted" or int(health.get("authority_generation", -1)) != generation:
            failures.append("worker_authority_health")
        if health.get("backlog_processing") is not False or cloud_authority.get("backlog_enabled") not in (0, False):
            failures.append("backlog_enabled")
        if cloud_authority.get("mode") != "self_hosted" or int(cloud_authority.get("generation", -1)) != generation:
            failures.append("cloud_authority_mismatch")
        if pg.get("mode") != "self_hosted" or int(pg.get("generation", -1)) != generation:
            failures.append("postgres_authority_mismatch")
        if int(active.get("claimed") or 0) + int(active.get("processing") or 0) > 1 or int(pg.get("active_leases") or 0) > 1:
            failures.append("concurrency_exceeded")
        for key in ("divergences", "mirror_errors", "stale_leases", "duplicate_completion_jobs", "publication_drift"):
            if int(pg.get(key) or 0) != 0:
                failures.append(key)
        if docker.get("unhealthy"):
            failures.append("container_health")
        if dispatcher.get("ok") is not True:
            failures.append("dispatcher_health")
        payload = {
            "ok": not failures,
            "sampled_at": now_iso(),
            "generation": generation,
            "failures": failures,
            "worker": health,
            "authority": authority,
            "postgres": pg,
            "docker": docker,
            "dispatcher": dispatcher,
        }
    except Exception as error:  # noqa: BLE001
        payload = {"ok": False, "sampled_at": now_iso(), "generation": generation, "failures": ["sampler_exception"], "error": str(error)[-1600:]}
    append_sample(payload)
    print(json.dumps(payload, indent=2, sort_keys=True, default=str))
    return payload


def initialise(generation: int) -> dict[str, Any]:
    authority = authority_state(generation).get("authority") or {}
    watermark = str(authority.get("cutover_watermark") or "")
    if authority.get("mode") != "self_hosted" or int(authority.get("generation", -1)) != generation or not watermark:
        raise SystemExit("Phase 6 local authority is not ready for soak")
    started = parse_time(watermark)
    payload = {
        "generation": generation,
        "started_at": watermark,
        "not_before": (started + timedelta(days=7)).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "required_duration_days": 7,
        "backlog_enabled": False,
        "concurrency": 1,
    }
    atomic_json(STATE_PATH, payload)
    return payload


def gate(generation: int) -> dict[str, Any]:
    state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    rows = [json.loads(line) for line in SAMPLES_PATH.read_text(encoding="utf-8").splitlines() if line.strip()]
    current = datetime.now(timezone.utc)
    not_before = parse_time(state["not_before"])
    latest = sample(generation)
    failures = [row for row in rows if not row.get("ok")]
    complete = int((latest.get("postgres") or {}).get("complete_since_watermark") or 0)
    ok = current >= not_before and not failures and latest.get("ok") is True and complete >= 1
    payload = {
        "ok": ok,
        "generation": generation,
        "started_at": state["started_at"],
        "not_before": state["not_before"],
        "samples": len(rows) + 1,
        "failed_samples": len(failures) + (0 if latest.get("ok") else 1),
        "completed_jobs_since_watermark": complete,
        "duration_elapsed": current >= not_before,
        "reason": None if ok else "duration, clean samples, and at least one genuine completed post-watermark job are required",
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 6 seven-day soak monitor")
    parser.add_argument("action", choices=("init", "sample", "gate"))
    parser.add_argument("--generation", type=int, required=True)
    args = parser.parse_args()
    if args.action == "init":
        payload = initialise(args.generation)
        print(json.dumps(payload, indent=2, sort_keys=True))
    elif args.action == "sample":
        payload = sample(args.generation)
    else:
        payload = gate(args.generation)
    return 0 if payload.get("ok", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())

