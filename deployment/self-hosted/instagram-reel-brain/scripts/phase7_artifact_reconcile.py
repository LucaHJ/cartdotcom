#!/usr/bin/env python3
"""Verify the Phase 7 local object root against an exported artifact manifest."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import stat
import tempfile
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath


def safe_relative(value: str) -> Path:
    parts = PurePosixPath(value.replace("\\", "/").lstrip("/")).parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"unsafe object key: {value!r}")
    return Path(*parts)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest-csv", required=True)
    parser.add_argument("--object-root", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--workers", type=int, default=4, choices=range(1, 9))
    parser.add_argument("--fetch-base-url")
    parser.add_argument("--token-file")
    args = parser.parse_args()
    root = Path(args.object_root).resolve(strict=True)
    if bool(args.fetch_base_url) != bool(args.token_file):
        raise SystemExit("--fetch-base-url and --token-file must be supplied together")
    token_path = Path(args.token_file) if args.token_file else None
    if token_path and os.name != "nt" and stat.S_IMODE(token_path.stat().st_mode) & 0o077:
        raise SystemExit("token file permissions are too broad")
    token = token_path.read_text(encoding="utf-8").strip() if token_path else ""
    with Path(args.manifest_csv).open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source, fieldnames=["object_key", "byte_size", "sha256"]))

    def verify(row: dict[str, str]) -> dict[str, object]:
        relative = safe_relative(row["object_key"])
        target = (root / relative).resolve(strict=False)
        if root not in target.parents:
            return {"key": row["object_key"], "error": "path_escape"}
        expected_size = int(row["byte_size"] or 0)
        expected_sha = (row["sha256"] or "").lower()
        if not target.is_file() and args.fetch_base_url:
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            url = f"{args.fetch_base_url.rstrip('/')}/api/phase7/object?{urllib.parse.urlencode({'key': row['object_key']})}"
            request = urllib.request.Request(url, headers={
                "Authorization": f"Bearer {token}",
                "User-Agent": "cartdotcom-phase7-artifact-reconcile/1",
            })
            with urllib.request.urlopen(request, timeout=180) as response:
                descriptor, temporary = tempfile.mkstemp(prefix=".phase7-object-", dir=target.parent)
                try:
                    digest = hashlib.sha256()
                    actual_size = 0
                    with os.fdopen(descriptor, "wb") as output:
                        while True:
                            chunk = response.read(1024 * 1024)
                            if not chunk:
                                break
                            output.write(chunk)
                            digest.update(chunk)
                            actual_size += len(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    actual_sha = digest.hexdigest()
                    if (expected_size and expected_size != actual_size) or (expected_sha and expected_sha != actual_sha):
                        return {"key": row["object_key"], "error": "download_mismatch", "actual": actual_size}
                    os.replace(temporary, target)
                    os.chmod(target, 0o600)
                finally:
                    if os.path.exists(temporary):
                        os.unlink(temporary)
        if not target.is_file():
            return {"key": row["object_key"], "error": "missing"}
        actual_size = target.stat().st_size
        if expected_size and expected_size != actual_size:
            return {"key": row["object_key"], "error": "size_mismatch", "expected": expected_size, "actual": actual_size}
        actual_sha = sha256_file(target)
        if expected_sha and expected_sha != actual_sha:
            return {"key": row["object_key"], "error": "sha256_mismatch", "expected": expected_sha, "actual": actual_sha}
        return {"key": row["object_key"], "bytes": actual_size, "sha256": actual_sha}

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(verify, rows))
    failures = [item for item in results if "error" in item]
    referenced = {safe_relative(row["object_key"]).as_posix() for row in rows}
    local = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and ".quarantine" not in path.relative_to(root).parts
    }
    report = {
        "ok": not failures,
        "manifest_objects": len(rows),
        "verified_objects": len(results) - len(failures),
        "verified_bytes": sum(int(item.get("bytes") or 0) for item in results),
        "failures": failures,
        "unreferenced_local_count": len(local - referenced),
        "unreferenced_local_keys": sorted(local - referenced),
    }
    report_path = Path(args.report)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if os.name != "nt":
        os.chmod(report_path, 0o600)
    print(json.dumps({key: value for key, value in report.items() if key not in {"failures", "unreferenced_local_keys"}}))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
