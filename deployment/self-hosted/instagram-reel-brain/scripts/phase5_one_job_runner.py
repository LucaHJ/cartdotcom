#!/usr/bin/env python3
"""
One-shot Phase 5 local runner for a single explicitly fenced job.

This is deliberately not a general worker:
- exact pilot_key/job_id/source_message_id/lease_owner are required;
- cloud D1 and local PostgreSQL state are rechecked before the start mutation;
- a fresh upload callback token is minted only after the exact cloud fence and
  local lease are still valid;
- the existing production processor implementation is imported and called
  directly for media acquisition, transcription callback, Codex schema output,
  artifact upload, completion publication, and status reactions.

Secrets are read only from existing local files/environment and are never
printed, placed in command arguments, or written to Git.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import secrets
import subprocess
import sys
import tempfile
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

MONOREPO_ROOT = Path(__file__).resolve().parents[4]
CLOUD_APP_PATH = MONOREPO_ROOT / "deployment" / "instagram-reel-brain" / "container" / "app.py"
WORKER_BASE_URL = "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev"
DEFAULT_SCHEMA = "reel_phase4_shadow_20260821_014246"
DEFAULT_WORKER = "phase5-local-worker-1"


def require_exact(value: str | None, name: str, max_length: int = 500) -> str:
    text = (value or "").strip()
    if not text or len(text) > max_length:
        raise SystemExit(f"{name} is required")
    return text


def sql_literal(value: str | None) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def parse_wrangler_json(stdout: str) -> list[dict[str, Any]]:
    start = stdout.find("[")
    end = stdout.rfind("]")
    if start < 0 or end < start:
        raise RuntimeError(f"could not locate Wrangler JSON result in output: {stdout[-500:]}")
    return json.loads(stdout[start : end + 1])


def wrangler_d1(command: str, *, cwd: Path, expect_mutation: bool | None = None) -> list[dict[str, Any]]:
    env = dict(os.environ)
    env.pop("CLOUDFLARE_API_TOKEN", None)
    npx = shutil.which("npx.cmd") or shutil.which("npx") or "npx"
    compact_command = " ".join(part.strip() for part in command.strip().splitlines() if part.strip())
    result = subprocess.run(
        [npx, "wrangler", "d1", "execute", "cartdotcom-instagram-reel-brain", "--remote", "--command", compact_command],
        cwd=str(cwd),
        env=env,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "wrangler d1 failed").strip()[-2000:])
    payload = parse_wrangler_json(result.stdout)
    if expect_mutation:
        changed = any(bool(item.get("meta", {}).get("changed_db")) for item in payload)
        if not changed:
            raise RuntimeError("expected D1 mutation, but Wrangler did not report one")
    return payload


def d1_rows(payload: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not payload:
        return []
    return list(payload[0].get("results") or [])


def ssh_psql_json(ssh_target: str, schema: str, sql: str) -> list[dict[str, Any]]:
    if not schema.replace("_", "").isalnum() or schema[0].isdigit():
        raise SystemExit("--schema must be a safe PostgreSQL identifier")
    command = "docker exec -i cartdotcom-platform-postgres-1 psql -U cartdotcom -d cartdotcom -v ON_ERROR_STOP=1 -q -t -A"
    result = subprocess.run(
        ["ssh", ssh_target, command],
        input=sql,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "remote psql failed").strip()[-2000:])
    rows = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def verify_cloud(args: argparse.Namespace, cwd: Path) -> dict[str, Any]:
    sql = f"""
      SELECT json_object(
        'job_id', j.id,
        'job_status', j.status,
        'job_stage', j.stage,
        'source_url', j.source_url,
        'canonical_url', j.canonical_url,
        'shortcode', j.shortcode,
        'sender_id', j.sender_id,
        'source_message_id', j.source_message_id,
        'instructions', j.instructions,
        'source_media_json', j.source_media_json,
        'completed_at', j.completed_at,
        'html_key', j.html_key,
        'library_path', j.library_path,
        'publication_artifacts', (
          SELECT count(*) FROM artifacts a
          WHERE a.job_id=j.id AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
        ),
        'completion_events', (
          SELECT count(*) FROM job_events e
          WHERE e.job_id=j.id AND e.stage IN ('complete','published','phase5_local_complete')
        ),
        'fence_status', f.status,
        'fence_owner', f.local_lease_owner,
        'fence_expires_at', f.expires_at,
        'fence_lease_expires_at', f.local_lease_expires_at
      ) AS row_json
      FROM jobs j
      JOIN phase5_local_pilot_fences f ON f.job_id=j.id
      WHERE f.pilot_key={sql_literal(args.pilot_key)}
        AND j.id={sql_literal(args.job_id)}
        AND j.source_message_id={sql_literal(args.source_message_id)}
        AND f.source_message_id={sql_literal(args.source_message_id)}
        AND f.local_lease_owner={sql_literal(args.lease_owner)};
    """
    rows = d1_rows(wrangler_d1(sql, cwd=cwd, expect_mutation=False))
    if len(rows) != 1:
        raise SystemExit("exact cloud fence/job row was not found")
    row = json.loads(rows[0]["row_json"])
    ok = (
        row["job_status"] == "queued"
        and row["fence_status"] == "local_claimed"
        and row["fence_owner"] == args.lease_owner
        and not row.get("completed_at")
        and not row.get("html_key")
        and not row.get("library_path")
        and int(row.get("publication_artifacts") or 0) == 0
        and int(row.get("completion_events") or 0) == 0
    )
    if not ok:
        raise SystemExit(f"cloud fence/job is not startable: {json.dumps(row, sort_keys=True)}")
    return row


def verify_local(args: argparse.Namespace) -> dict[str, Any]:
    schema = args.schema
    sql = f"""
      SELECT json_build_object(
        'pilot_key', l.pilot_key,
        'job_id', l.exact_job_id,
        'source_message_id', l.source_message_id,
        'lease_owner', l.lease_owner,
        'lease_status', l.status,
        'lease_expires_at', l.lease_expires_at,
        'job_status', j.status,
        'html_key', j.html_key,
        'library_path', j.library_path,
        'completed_at', j.completed_at,
        'publication_artifacts', (
          SELECT count(*) FROM {schema}.artifacts a
          WHERE a.job_id=l.exact_job_id AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
        ),
        'completion_events', (
          SELECT count(*) FROM {schema}.job_events e
          WHERE e.job_id=l.exact_job_id AND e.stage IN ('complete','published','phase5_local_complete')
        )
      )
      FROM {schema}.phase5_pilot_leases l
      JOIN {schema}.jobs j ON j.id=l.exact_job_id
      WHERE l.pilot_key={sql_literal(args.pilot_key)}
        AND l.exact_job_id={sql_literal(args.job_id)}
        AND l.source_message_id={sql_literal(args.source_message_id)}
        AND l.lease_owner={sql_literal(args.lease_owner)};
    """
    rows = ssh_psql_json(args.ssh_target, schema, sql)
    if len(rows) != 1:
        raise SystemExit("exact local lease/job row was not found")
    row = rows[0]
    ok = (
        row["lease_status"] == "leased"
        and row["job_status"] == "queued"
        and not row.get("completed_at")
        and not row.get("html_key")
        and not row.get("library_path")
        and int(row.get("publication_artifacts") or 0) == 0
        and int(row.get("completion_events") or 0) == 0
    )
    if not ok:
        raise SystemExit(f"local lease/job is not startable: {json.dumps(row, sort_keys=True, default=str)}")
    return row


def start_cloud_job(args: argparse.Namespace, cwd: Path, callback_token: str, token_expires_at: str) -> None:
    token_hash = hashlib.sha256(callback_token.encode("utf-8")).hexdigest()
    sql = f"""
      UPDATE jobs
      SET status='running',
          stage='downloading',
          status_emoji='⬇️',
          started_at=COALESCE(started_at,CURRENT_TIMESTAMP),
          attempts=attempts+1,
          upload_token_hash={sql_literal(token_hash)},
          upload_token_expires_at={sql_literal(token_expires_at)},
          updated_at=CURRENT_TIMESTAMP
      WHERE id={sql_literal(args.job_id)}
        AND source_message_id={sql_literal(args.source_message_id)}
        AND status='queued'
        AND completed_at IS NULL
        AND html_key IS NULL
        AND library_path IS NULL;
      UPDATE phase5_local_pilot_fences
      SET status='local_processing',
          local_lease_expires_at={sql_literal(token_expires_at)},
          updated_at=CURRENT_TIMESTAMP
      WHERE pilot_key={sql_literal(args.pilot_key)}
        AND job_id={sql_literal(args.job_id)}
        AND source_message_id={sql_literal(args.source_message_id)}
        AND status='local_claimed'
        AND local_lease_owner={sql_literal(args.lease_owner)};
      INSERT INTO job_events(job_id,stage,status,emoji,detail)
      VALUES (
        {sql_literal(args.job_id)},
        'phase5_local_processing',
        'running',
        '🧪',
        {sql_literal(json.dumps({"pilot_key": args.pilot_key, "lease_owner": args.lease_owner, "token_expires_at": token_expires_at}))}
      );
    """
    wrangler_d1(sql, cwd=cwd, expect_mutation=True)
    verify_sql = f"""
      SELECT id,status,stage,upload_token_expires_at FROM jobs
      WHERE id={sql_literal(args.job_id)} AND status='running' AND stage='downloading';
    """
    if len(d1_rows(wrangler_d1(verify_sql, cwd=cwd, expect_mutation=False))) != 1:
        raise SystemExit("cloud start mutation did not leave the exact job in running/downloading state")


def mark_cloud_complete(args: argparse.Namespace, cwd: Path) -> None:
    sql = f"""
      UPDATE phase5_local_pilot_fences
      SET status='local_complete',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE pilot_key={sql_literal(args.pilot_key)}
        AND job_id={sql_literal(args.job_id)}
        AND source_message_id={sql_literal(args.source_message_id)}
        AND status='local_processing'
        AND local_lease_owner={sql_literal(args.lease_owner)}
        AND EXISTS (SELECT 1 FROM jobs j WHERE j.id=phase5_local_pilot_fences.job_id AND j.status='complete');
      INSERT INTO job_events(job_id,stage,status,emoji,detail)
      VALUES (
        {sql_literal(args.job_id)},
        'phase5_local_complete',
        'complete',
        '✅',
        {sql_literal(json.dumps({"pilot_key": args.pilot_key, "lease_owner": args.lease_owner}))}
      );
    """
    wrangler_d1(sql, cwd=cwd, expect_mutation=True)


def complete_local_lease(args: argparse.Namespace, result: dict[str, Any]) -> None:
    schema = args.schema
    safe_detail = json.dumps(
        {
            "resources": result.get("resources"),
            "frames": result.get("frames"),
            "carousel_items": result.get("carousel_items"),
            "shortcode": result.get("shortcode"),
        },
        separators=(",", ":"),
    )
    sql = f"""
      BEGIN;
      UPDATE {schema}.phase5_pilot_leases
      SET status='completed',completed_at=now(),updated_at=now()
      WHERE pilot_key={sql_literal(args.pilot_key)}
        AND exact_job_id={sql_literal(args.job_id)}
        AND source_message_id={sql_literal(args.source_message_id)}
        AND lease_owner={sql_literal(args.lease_owner)}
        AND status IN ('leased','processing');
      INSERT INTO {schema}.phase5_pilot_events(pilot_key,job_id,stage,status,detail)
      VALUES ({sql_literal(args.pilot_key)},{sql_literal(args.job_id)},'completed','completed',{sql_literal(safe_detail)}::jsonb);
      COMMIT;
    """
    ssh_psql_json(args.ssh_target, schema, sql + "\nSELECT '{}'::json;\n")


def load_processor_module():
    if not CLOUD_APP_PATH.exists():
        raise SystemExit(f"production processor not found at {CLOUD_APP_PATH}")
    spec = importlib.util.spec_from_file_location("phase5_cloud_processor", CLOUD_APP_PATH)
    if not spec or not spec.loader:
        raise SystemExit("could not load production processor module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_codex_auth(path: Path) -> str:
    if not path.exists():
        raise SystemExit(f"Codex auth file not found at {path}")
    text = path.read_text(encoding="utf-8").strip()
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise SystemExit("Codex auth file is not a JSON object")
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description="Run exactly one Phase 5 local pilot job")
    parser.add_argument("--pilot-key", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--source-message-id", required=True)
    parser.add_argument("--lease-owner", default=DEFAULT_WORKER)
    parser.add_argument("--schema", default=DEFAULT_SCHEMA)
    parser.add_argument("--ssh-target", default=os.environ.get("REEL_PHASE2_PG_SSH_TARGET", "cartdotcom-server"))
    parser.add_argument("--worker-url", default=WORKER_BASE_URL)
    parser.add_argument("--cloud-cwd", default=str(MONOREPO_ROOT / "deployment" / "instagram-reel-brain"))
    parser.add_argument("--codex-auth-path", default=str(Path.home() / ".codex" / "auth.json"))
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--token-minutes", type=int, default=240)
    parser.add_argument("--dry-run", action="store_true", help="verify exact state without starting the job")
    parser.add_argument("--confirm-live-run", default="")
    args = parser.parse_args()

    args.pilot_key = require_exact(args.pilot_key, "--pilot-key", 120)
    args.job_id = require_exact(args.job_id, "--job-id", 120)
    args.source_message_id = require_exact(args.source_message_id, "--source-message-id")
    args.lease_owner = require_exact(args.lease_owner, "--lease-owner", 120)

    cwd = Path(args.cloud_cwd)
    cloud = verify_cloud(args, cwd)
    local = verify_local(args)
    safe_summary = {
        "ok": True,
        "dry_run": bool(args.dry_run),
        "job_id": args.job_id,
        "pilot_key": args.pilot_key,
        "source_url": cloud.get("source_url"),
        "cloud": {key: cloud.get(key) for key in ("job_status", "job_stage", "fence_status", "fence_owner", "fence_lease_expires_at")},
        "local": {key: local.get(key) for key in ("lease_status", "lease_owner", "lease_expires_at", "job_status")},
    }
    if args.dry_run:
        print(json.dumps(safe_summary, indent=2, sort_keys=True, default=str))
        return 0
    expected_confirmation = f"RUN EXACT PHASE 5 LOCAL PILOT {args.job_id}"
    if args.confirm_live_run != expected_confirmation:
        raise SystemExit(f"--confirm-live-run must equal {expected_confirmation}")

    callback_token = secrets.token_urlsafe(48)
    token_expires_at = (datetime.now(timezone.utc) + timedelta(minutes=max(30, min(args.token_minutes, 360)))).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    start_cloud_job(args, cwd, callback_token, token_expires_at)

    processor = load_processor_module()
    payload = {
        "job_id": args.job_id,
        "source_url": cloud.get("source_url") or cloud.get("canonical_url"),
        "callback_base_url": args.worker_url,
        "callback_token": callback_token,
        "instructions": cloud.get("instructions") or "",
        "codex_auth_json": load_codex_auth(Path(args.codex_auth_path)),
        "instagram_cookies_json": os.environ.get("INSTAGRAM_COOKIES_JSON", ""),
        "instagram_media_json": cloud.get("source_media_json") or "",
        "timeout_seconds": args.timeout_seconds,
    }
    result = processor.process(payload)
    if isinstance(result, dict):
        result.pop("auth_json", None)
    mark_cloud_complete(args, cwd)
    complete_local_lease(args, result if isinstance(result, dict) else {})
    print(json.dumps({"ok": True, "job_id": args.job_id, "pilot_key": args.pilot_key, "result": result}, indent=2, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
