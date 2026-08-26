#!/usr/bin/env python3
"""Apply an explicitly curated Reel-list backfill without exposing control auth."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import requests


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker-url", required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--payload", type=Path, required=True)
    args = parser.parse_args()
    token = args.token_file.read_text(encoding="utf-8").strip()
    payload = json.loads(args.payload.read_text(encoding="utf-8"))
    response = requests.post(
        f"{args.worker_url.rstrip('/')}/api/admin/reel-library/backfill-lists",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=180,
    )
    result = response.json()
    if not response.ok:
        raise SystemExit(f"list backfill failed ({response.status_code}): {result.get('error', 'unknown error')}")
    print(json.dumps({"ok": True, "job_id": result.get("job_id"), "lists": result.get("lists"), "root_path": result.get("root_path")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
