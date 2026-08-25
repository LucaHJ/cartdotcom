import importlib.util
import json
import os
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest import mock
from http.server import ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "services" / "media-processor-api" / "app.py"
CLOUD_PROCESSOR = ROOT.parents[1] / "instagram-reel-brain" / "container" / "app.py"
RUNTIME_PROCESSOR = ROOT / "phase5-runner" / "container" / "app.py"


def load_module(storage_root: Path, *, enabled=True, max_body=1048576):
    os.environ["REEL_MEDIA_PROCESSOR_ENABLED"] = "true" if enabled else "false"
    os.environ["REEL_MEDIA_FIXTURE_ONLY"] = "true"
    os.environ["REEL_TEST_STORAGE_ROOT"] = str(storage_root)
    os.environ["REEL_INTERNAL_API_TOKEN"] = "fixture-token"
    os.environ["REEL_MEDIA_MAX_BODY_BYTES"] = str(max_body)
    os.environ["REEL_CLOUD_PROCESSOR_PATH"] = str(CLOUD_PROCESSOR)
    spec = importlib.util.spec_from_file_location(f"phase2_media_api_{id(storage_root)}", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_processor():
    spec = importlib.util.spec_from_file_location("phase2_cloud_processor_timeout_test", CLOUD_PROCESSOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_runtime_processor():
    spec = importlib.util.spec_from_file_location("phase6_runtime_processor_prefetch_test", RUNTIME_PROCESSOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RunningServer:
    def __init__(self, module):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), module.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def post_json(base_url: str, payload, token="fixture-token"):
    data = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/process-fixture",
        data=data,
        method="POST",
        headers={"content-type": "application/json", "x-reel-internal-token": token},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def make_synthetic_video(path: Path):
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=size=160x120:rate=1:duration=5",
        "-vf", "format=yuvj420p", "-pix_fmt", "yuvj420p", str(path),
    ], check=True)


class MediaProcessorApiTests(unittest.TestCase):
    def test_prefetch_cache_is_exact_atomic_and_hash_verified(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            module = load_runtime_processor()

            def fake_download(source_url, workdir, *_args):
                video = workdir / "reel.mp4"
                video.write_bytes(b"prefetched-video")
                return video, {
                    "id": "test-prefetch",
                    "canonical_url": source_url,
                    "title": "Prefetch fixture",
                    "description": "Fixture only",
                    "author_username": "fixture",
                    "comments": [],
                }, [], None, []

            cache = root / "cache" / "job-1"
            with mock.patch.object(module, "download_instagram_media", side_effect=fake_download):
                created = module.prefetch_media(
                    "https://www.instagram.com/reel/test-prefetch/", "job-1", "message-1", cache,
                )
            self.assertTrue(created["ok"])
            self.assertTrue((cache / "prefetch.json").is_file())
            restored = root / "restored"
            restored.mkdir()
            video, metadata, items, manifest, frames = module.load_prefetched_media(
                cache, restored, job_id="job-1", source_url="https://www.instagram.com/reel/test-prefetch/",
            )
            self.assertEqual(video.read_bytes(), b"prefetched-video")
            self.assertEqual(metadata["id"], "test-prefetch")
            self.assertEqual((items, manifest, frames), ([], None, []))
            (cache / "reel.mp4").write_bytes(b"tampered")
            with self.assertRaisesRegex(module.PipelineError, "integrity"):
                module.load_prefetched_media(
                    cache, restored, job_id="job-1", source_url="https://www.instagram.com/reel/test-prefetch/",
                )

    def test_optional_frame_and_audio_timeouts_do_not_fail_media_probe(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            module = load_processor()
            video = root / "synthetic.mp4"
            video.write_bytes(b"fixture")
            probe = json.dumps({"format": {"duration": "9.0"}, "streams": [{"codec_type": "video"}]})
            with mock.patch.object(module, "run", return_value=probe), mock.patch.object(
                module.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired(cmd=["ffmpeg"], timeout=20),
            ):
                parsed, audio, frames = module.inspect_and_extract(video, root)
            self.assertEqual(parsed["format"]["duration"], "9.0")
            self.assertIsNone(audio)
            self.assertEqual(frames, [])

    def test_disabled_by_default_refuses_fixture_processing(self):
        with tempfile.TemporaryDirectory() as raw:
            module = load_module(Path(raw), enabled=False)
            server = RunningServer(module)
            try:
                status, payload = post_json(server.url, {"job_id": "job", "source_key": "missing.mp4"})
            finally:
                server.close()
        self.assertEqual(status, 503)
        self.assertEqual(payload["error"], "media_processor_disabled_for_phase2")

    def test_malformed_json_and_body_size_are_rejected(self):
        with tempfile.TemporaryDirectory() as raw:
            module = load_module(Path(raw), enabled=True, max_body=8)
            server = RunningServer(module)
            try:
                status, payload = post_json(server.url, b"{bad")
                self.assertEqual(status, 400)
                self.assertEqual(payload["error"], "malformed_json")
                status, payload = post_json(server.url, {"too": "large for configured limit"})
                self.assertEqual(status, 413)
                self.assertEqual(payload["error"], "request_body_too_large")
            finally:
                server.close()

    def test_fixture_media_api_uses_existing_processor_for_synthetic_video(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            fixture = root / "input" / "synthetic.mp4"
            fixture.parent.mkdir(parents=True)
            make_synthetic_video(fixture)
            module = load_module(root, enabled=True)
            server = RunningServer(module)
            try:
                status, payload = post_json(server.url, {"job_id": "job-1", "source_key": "input/synthetic.mp4"})
            finally:
                server.close()

            self.assertEqual(status, 200, payload)
            self.assertTrue(payload["ok"])
            self.assertTrue(payload["fixture_only"])
            self.assertEqual(payload["job_id"], "job-1")
            self.assertGreater(payload["byte_length"], 0)
            self.assertIn("format", payload["probe"])
            frames = [item for item in payload["outputs"] if item["kind"] == "frame"]
            self.assertGreaterEqual(len(frames), 1)
            for item in frames:
                self.assertTrue((root / item["key"]).exists())


if __name__ == "__main__":
    unittest.main()
