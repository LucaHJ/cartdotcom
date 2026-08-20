#!/usr/bin/env python3
"""Internal-only Phase 2 media API wrapper.

This does not process real Instagram media by default. It provides a narrow
contract around the existing Python processor shape so fixture tests and later
internal services have a stable local API without enabling production work.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SERVICE_NAME = os.environ.get("REEL_SERVICE_NAME", "reel-media-processor")
ENABLED = os.environ.get("REEL_MEDIA_PROCESSOR_ENABLED", "false").lower() == "true"
FIXTURE_ONLY = os.environ.get("REEL_MEDIA_FIXTURE_ONLY", "true").lower() == "true"
STORAGE_ROOT = Path(os.environ.get("REEL_TEST_STORAGE_ROOT", "/tmp/reel-media-fixtures")).resolve()
INTERNAL_TOKEN = os.environ.get("REEL_INTERNAL_API_TOKEN", "")


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def safe_path(value: str) -> Path:
    target = (STORAGE_ROOT / value.lstrip("/")).resolve()
    if target == STORAGE_ROOT or not str(target).startswith(str(STORAGE_ROOT) + os.sep):
        raise ValueError("path escapes REEL_TEST_STORAGE_ROOT")
    return target


class Handler(BaseHTTPRequestHandler):
    server_version = "ReelMediaProcessorPhase2/0.1"

    def send_json(self, status: int, payload: dict) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorised(self) -> bool:
        if not INTERNAL_TOKEN:
            return False
        return self.headers.get("x-reel-internal-token", "") == INTERNAL_TOKEN

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/healthz", "/readyz"):
            self.send_json(200, {
                "ok": True,
                "service": SERVICE_NAME,
                "enabled": ENABLED,
                "fixture_only": FIXTURE_ONLY,
            })
            return
        self.send_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/process-fixture":
            self.send_json(404, {"ok": False, "error": "not_found"})
            return
        if not ENABLED or not FIXTURE_ONLY:
            self.send_json(503, {"ok": False, "error": "media_processor_disabled_for_phase2"})
            return
        if not self.authorised():
            self.send_json(401, {"ok": False, "error": "unauthorised"})
            return
        length = int(self.headers.get("content-length", "0") or "0")
        payload = json.loads(self.rfile.read(length) or b"{}")
        try:
            source = safe_path(str(payload.get("source_key", "")))
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
            return
        if not source.exists():
            self.send_json(404, {"ok": False, "error": "fixture_source_missing"})
            return
        self.send_json(200, {
            "ok": True,
            "fixture_only": True,
            "source_key": str(payload.get("source_key", "")),
            "byte_length": source.stat().st_size,
            "outputs": [],
        })


def main() -> None:
    port = int(os.environ.get("PORT", "3110"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
