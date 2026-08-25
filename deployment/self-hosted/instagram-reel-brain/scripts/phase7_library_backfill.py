#!/usr/bin/env python3
"""Read-only KV-to-local Phase 7 Reel Library backfill."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath


def safe_path(value: str) -> Path:
    parts = PurePosixPath(str(value).replace("\\", "/").lstrip("/")).parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("unsafe library path")
    return Path(*parts)


def request(url: str, token: str) -> tuple[dict[str, str], bytes]:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}), timeout=60) as response:
        return {key.lower(): value for key, value in response.headers.items()}, response.read()


def atomic_verified_write(root: Path, relative: Path, body: bytes, expected_sha: str) -> None:
    target = (root / relative).resolve(strict=False)
    if root not in target.parents:
        raise ValueError("path escape")
    actual = hashlib.sha256(body).hexdigest()
    if expected_sha and actual != expected_sha:
        raise RuntimeError(f"checksum mismatch: {relative.as_posix()}")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if target.exists():
        if target.stat().st_size != len(body) or hashlib.sha256(target.read_bytes()).hexdigest() != actual:
            raise RuntimeError(f"existing library divergence: {relative.as_posix()}")
        return
    descriptor, temporary = tempfile.mkstemp(prefix=".phase7-library-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, target)
        os.chmod(target, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="https://cartdotcom-instagram-reel-brain.lucajeannin.workers.dev")
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--library-root", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    token_path = Path(args.token_file)
    if os.name != "nt" and stat.S_IMODE(token_path.stat().st_mode) & 0o077:
        raise SystemExit("token file permissions are too broad")
    token = token_path.read_text(encoding="utf-8").strip()
    headers, raw = request(f"{args.base_url.rstrip('/')}/api/phase7/library/manifest", token)
    del headers
    manifest = json.loads(raw)
    files = manifest.get("files") if isinstance(manifest, dict) else None
    if not isinstance(files, list):
        raise SystemExit("invalid library manifest")
    root = Path(args.library_root).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    copied = 0
    for item in files:
        if not isinstance(item, dict) or not str(item.get("path") or "").endswith(".html"):
            continue
        relative = safe_path(str(item["path"]))
        url = f"{args.base_url.rstrip('/')}/api/phase7/library/file?{urllib.parse.urlencode({'path': relative.as_posix()})}"
        file_headers, body = request(url, token)
        atomic_verified_write(root, relative, body, file_headers.get("x-content-sha256", ""))
        copied += 1
    report = {"ok": True, "manifest_file_count": int(manifest.get("file_count") or len(files)), "copied_or_verified": copied}
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    os.chmod(args.report, 0o600)
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
