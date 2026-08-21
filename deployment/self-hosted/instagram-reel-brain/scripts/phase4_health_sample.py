#!/usr/bin/env python3
"""Write one Phase 4 Reel/News health sample.

This is local evidence collection only. It does not read mirror credentials,
call mirror endpoints, mutate production, claim work, or process backlog.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_HEALTH_URL = "https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev/health"


def capture(command: list[str]) -> dict[str, object]:
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    return {
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout.splitlines(),
        "stderr": result.stderr.splitlines(),
    }


def fetch_health(url: str) -> dict[str, object]:
    request = urllib.request.Request(url, headers={"User-Agent": "phase4-shadow-monitor/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8", "replace")
            return {"status": response.status, "body": json.loads(body)}
    except urllib.error.HTTPError as error:
        return {"status": error.code, "body": error.read().decode("utf-8", "replace")[:500]}
    except Exception as error:  # noqa: BLE001 - health evidence should capture exact failure
        return {"error": str(error)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", required=True)
    parser.add_argument("--health-url", default=DEFAULT_HEALTH_URL)
    args = parser.parse_args()
    run_dir = Path(args.run_dir).resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    sample = {
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "cloudflare_health": fetch_health(args.health_url),
        "docker_ps": capture(["docker", "ps", "--format", "{{.Names}} {{.Status}}"]),
        "docker_stats": capture(["docker", "stats", "--no-stream", "--format", "{{.Name}} {{.CPUPerc}} {{.MemUsage}}"]),
        "disk": capture(["df", "-h", "/srv"]),
        "uptime": capture(["uptime"]),
    }
    line = json.dumps(sample, sort_keys=True)
    with (run_dir / "health-samples.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")
    print(line, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
