#!/usr/bin/env python3
"""Internal-only Phase 2 media API wrapper.

This does not process real Instagram media by default. It provides a narrow
contract around the existing Python processor shape so fixture tests and later
internal services have a stable local API without enabling production work.
"""

from __future__ import annotations

import json
import os
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SERVICE_NAME = os.environ.get("REEL_SERVICE_NAME", "reel-media-processor")
ENABLED = os.environ.get("REEL_MEDIA_PROCESSOR_ENABLED", "false").lower() == "true"
FIXTURE_ONLY = os.environ.get("REEL_MEDIA_FIXTURE_ONLY", "true").lower() == "true"
STORAGE_ROOT = Path(os.environ.get("REEL_TEST_STORAGE_ROOT", "/tmp/reel-media-fixtures")).resolve()
INTERNAL_TOKEN = os.environ.get("REEL_INTERNAL_API_TOKEN", "")
MAX_BODY_BYTES = int(os.environ.get("REEL_MEDIA_MAX_BODY_BYTES", "1048576"))
DEFAULT_PROCESSOR_PATH = Path(__file__).resolve().parents[4] / "instagram-reel-brain" / "container" / "app.py"
PROCESSOR_PATH = Path(os.environ.get("REEL_CLOUD_PROCESSOR_PATH", str(DEFAULT_PROCESSOR_PATH))).resolve()


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def safe_path(value: str) -> Path:
    target = (STORAGE_ROOT / value.lstrip("/")).resolve()
    if target == STORAGE_ROOT or not str(target).startswith(str(STORAGE_ROOT) + os.sep):
        raise ValueError("path escapes REEL_TEST_STORAGE_ROOT")
    return target


def storage_key(path: Path) -> str:
    return path.resolve().relative_to(STORAGE_ROOT).as_posix()


def load_existing_processor():
    if not PROCESSOR_PATH.exists():
        raise RuntimeError(f"existing processor not found: {PROCESSOR_PATH}")
    spec = importlib.util.spec_from_file_location("cloud_reel_processor_phase2", PROCESSOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"existing processor could not be imported: {PROCESSOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not hasattr(module, "inspect_and_extract"):
        raise RuntimeError("existing processor missing inspect_and_extract")
    return module


def process_fixture_media(source: Path, job_id: str) -> dict:
    processor = load_existing_processor()
    output_dir = safe_path(f"outputs/{job_id}")
    output_dir.mkdir(parents=True, exist_ok=True)
    probe, audio, frames = processor.inspect_and_extract(source, output_dir)
    outputs = []
    if audio:
        outputs.append({"kind": "audio", "key": storage_key(audio), "byte_length": audio.stat().st_size})
    for frame in frames:
        outputs.append({"kind": "frame", "key": storage_key(frame), "byte_length": frame.stat().st_size})
    return {
        "probe": probe,
        "outputs": outputs,
    }


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
        if length > MAX_BODY_BYTES:
            self.send_json(413, {"ok": False, "error": "request_body_too_large"})
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json(400, {"ok": False, "error": "malformed_json"})
            return
        job_id = str(payload.get("job_id") or "fixture-job").strip()
        if not job_id or "/" in job_id or "\\" in job_id or ".." in job_id:
            self.send_json(400, {"ok": False, "error": "invalid_job_id"})
            return
        try:
            source = safe_path(str(payload.get("source_key", "")))
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
            return
        if not source.exists():
            self.send_json(404, {"ok": False, "error": "fixture_source_missing"})
            return
        try:
            processed = process_fixture_media(source, job_id)
        except Exception as error:  # noqa: BLE001
            self.send_json(500, {"ok": False, "error": "fixture_media_processing_failed", "detail": str(error)[:500]})
            return
        self.send_json(200, {
            "ok": True,
            "fixture_only": True,
            "job_id": job_id,
            "source_key": str(payload.get("source_key", "")),
            "byte_length": source.stat().st_size,
            **processed,
        })


def main() -> None:
    port = int(os.environ.get("PORT", "3110"))
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
