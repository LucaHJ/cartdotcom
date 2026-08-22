#!/usr/bin/env python3
"""
Guard utility for one exact Phase 5 local pilot job.

This script is intentionally generic and secret-free. It never stores or prints
the admin token. Cloud actions require PHASE5_ADMIN_TOKEN in the process
environment and call existing admin-only Worker endpoints.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

CLOUD_RENEW_CONFIRMATION = "RENEW EXACT PHASE 5 LOCAL PILOT LEASE"
CLOUD_ROLLBACK_CONFIRMATION = "ROLL BACK PHASE 5 LOCAL PILOT JOB"


def require_exact(value: str | None, name: str, max_length: int = 500) -> str:
    text = (value or "").strip()
    if not text or len(text) > max_length:
        raise SystemExit(f"{name} is required")
    return text


def post_admin_json(base_url: str, path: str, token_env: str, payload: dict) -> dict:
    token = os.environ.get(token_env, "")
    if not token:
        raise SystemExit(f"{token_env} must be set for cloud admin action")
    url = base_url.rstrip("/") + path
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
            "accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"cloud admin request failed: HTTP {exc.code}: {body}") from exc


def psql_json(command: str, sql: str) -> list[dict]:
    completed = subprocess.run(
        command + ["-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        raise SystemExit(completed.stderr.strip() or "psql command failed")
    output = completed.stdout.strip()
    if not output:
        return []
    return [json.loads(line) for line in output.splitlines()]


def local_check(args: argparse.Namespace) -> dict:
    pilot_key = require_exact(args.pilot_key, "--pilot-key", 120)
    job_id = require_exact(args.job_id, "--job-id", 120)
    source_message_id = require_exact(args.source_message_id, "--source-message-id")
    lease_owner = require_exact(args.lease_owner, "--lease-owner", 120)
    schema = require_exact(args.schema, "--schema", 80)
    if not schema.replace("_", "").isalnum() or schema[0].isdigit():
        raise SystemExit("--schema must be a safe PostgreSQL identifier")
    psql = args.psql_command or ["psql"]
    sql = f"""
      SELECT json_build_object(
        'pilot_key', l.pilot_key,
        'job_id', l.exact_job_id,
        'source_message_id', l.source_message_id,
        'lease_owner', l.lease_owner,
        'lease_status', l.status,
        'lease_expires_at', l.lease_expires_at,
        'job_status', j.status,
        'job_stage', j.stage,
        'html_key', j.html_key,
        'library_path', j.library_path,
        'completed_at', j.completed_at,
        'publication_artifacts', (
          SELECT count(*) FROM {schema}.artifacts a
          WHERE a.job_id=l.exact_job_id
            AND (a.object_key LIKE 'library/%' OR a.object_key LIKE 'reels/%/index.html')
        ),
        'completion_events', (
          SELECT count(*) FROM {schema}.job_events e
          WHERE e.job_id=l.exact_job_id
            AND e.stage IN ('complete','published','phase5_local_complete')
        )
      )
      FROM {schema}.phase5_pilot_leases l
      JOIN {schema}.jobs j ON j.id=l.exact_job_id
      WHERE l.pilot_key={json.dumps(pilot_key)}
        AND l.exact_job_id={json.dumps(job_id)}
        AND l.source_message_id={json.dumps(source_message_id)}
        AND l.lease_owner={json.dumps(lease_owner)};
    """
    rows = psql_json(psql, sql)
    if len(rows) != 1:
        raise SystemExit("exact local lease/job row not found")
    row = rows[0]
    renewable = (
        row.get("lease_status") == "leased"
        and row.get("job_status") == "queued"
        and not row.get("html_key")
        and not row.get("library_path")
        and not row.get("completed_at")
        and int(row.get("publication_artifacts") or 0) == 0
        and int(row.get("completion_events") or 0) == 0
    )
    result = {"ok": renewable, "renewable": renewable, "row": row}
    print(json.dumps(result, indent=2, sort_keys=True, default=str))
    if not renewable:
        raise SystemExit(2)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Exact Phase 5 local-pilot guard")
    parser.add_argument("action", choices=["check-local", "renew-cloud", "rollback-cloud"])
    parser.add_argument("--worker-url", default="https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev")
    parser.add_argument("--token-env", default="PHASE5_ADMIN_TOKEN")
    parser.add_argument("--pilot-key", required=True)
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--source-message-id", required=True)
    parser.add_argument("--lease-owner", default="phase5-local-worker-1")
    parser.add_argument("--expires-minutes", type=int, default=180)
    parser.add_argument("--reason", default="phase5_exact_job_operator_guard")
    parser.add_argument("--schema", default="reel_phase4_shadow_20260821_014246")
    parser.add_argument("--psql-command", nargs="+")
    args = parser.parse_args()

    if args.action == "check-local":
        local_check(args)
        return 0
    if args.action == "renew-cloud":
        payload = {
            "pilot_key": require_exact(args.pilot_key, "--pilot-key", 120),
            "job_id": require_exact(args.job_id, "--job-id", 120),
            "source_message_id": require_exact(args.source_message_id, "--source-message-id"),
            "lease_owner": require_exact(args.lease_owner, "--lease-owner", 120),
            "confirm_renew": CLOUD_RENEW_CONFIRMATION,
            "expires_minutes": args.expires_minutes,
            "reason": args.reason,
        }
        print(json.dumps(post_admin_json(args.worker_url, "/api/admin/phase5/local-pilot/renew", args.token_env, payload), indent=2, sort_keys=True))
        return 0
    if args.action == "rollback-cloud":
        payload = {
            "pilot_key": require_exact(args.pilot_key, "--pilot-key", 120),
            "job_id": require_exact(args.job_id, "--job-id", 120),
            "source_message_id": require_exact(args.source_message_id, "--source-message-id"),
            "confirm_rollback": CLOUD_ROLLBACK_CONFIRMATION,
            "reason": args.reason,
        }
        print(json.dumps(post_admin_json(args.worker_url, "/api/admin/phase5/local-pilot/rollback", args.token_env, payload), indent=2, sort_keys=True))
        return 0
    raise SystemExit("unhandled action")


if __name__ == "__main__":
    raise SystemExit(main())
