import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import app


class FakeResponse:
    def __init__(self, data: bytes):
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def raise_for_status(self):
        return None

    def iter_content(self, _size):
        yield self.data


class FakeJsonResponse:
    ok = True

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


class RecoveryTests(unittest.TestCase):
    def test_selects_largest_image_candidate_instead_of_last_thumbnail(self):
        candidates = [
            {"url": "https://example.test/original.jpg", "width": 1170, "height": 1560},
            {"url": "https://example.test/medium.jpg", "width": 720, "height": 960},
            {"url": "https://example.test/thumb.jpg", "width": 150, "height": 150},
        ]
        self.assertEqual(app.select_largest_image_candidate(candidates)["url"], "https://example.test/original.jpg")

    def test_instagram_cookie_file_is_scoped_and_private(self):
        with tempfile.TemporaryDirectory() as raw:
            workdir = Path(raw)
            cookie_path = app.write_instagram_cookies(json.dumps([
                {"name": "sessionid", "value": "secret", "domain": ".instagram.com", "path": "/", "secure": True},
                {"name": "ignore", "value": "bad", "domain": ".example.com", "path": "/"},
            ]), workdir)
            self.assertIsNotNone(cookie_path)
            text = cookie_path.read_text(encoding="utf-8")
            self.assertIn("sessionid\tsecret", text)
            self.assertNotIn("example.com", text)
            if os.name != "nt":
                self.assertEqual(cookie_path.stat().st_mode & 0o777, 0o600)

    def test_invalid_cookie_payload_is_classified_as_auth(self):
        with tempfile.TemporaryDirectory() as raw:
            with self.assertRaises(app.PipelineError) as raised:
                app.write_instagram_cookies("{}", Path(raw))
            self.assertEqual(raised.exception.code, "error_auth")

    def test_research_resume_restores_only_required_archived_evidence(self):
        metadata = json.dumps({"id": "abc", "title": "Example", "comments": []}).encode()
        transcript = json.dumps({"ok": True, "text": "hello"}).encode()
        payloads = iter([metadata, transcript, b"jpeg"])
        rows = [
            {"kind": "metadata", "filename": "metadata.json", "url": "https://worker/internal/jobs/job-1/artifacts/a"},
            {"kind": "transcript", "filename": "transcript.json", "url": "https://worker/internal/jobs/job-1/artifacts/b"},
            {"kind": "frame", "filename": "frame-01.jpg", "url": "https://worker/internal/jobs/job-1/artifacts/c"},
        ]
        with tempfile.TemporaryDirectory() as raw, patch.object(app.requests, "get", side_effect=lambda *_args, **_kwargs: FakeResponse(next(payloads))):
            restored_metadata, restored_transcript, frames = app.load_resume_artifacts(
                "https://worker", "token", "job-1", rows, Path(raw),
            )
            self.assertEqual(restored_metadata["id"], "abc")
            self.assertEqual(restored_transcript["text"], "hello")
            self.assertEqual(len(frames), 1)

    def test_private_instagram_carousel_is_normalised_into_ordered_entries(self):
        payload = {
            "items": [{
                "code": "DCarousel01",
                "caption": {"text": "Read these manga"},
                "user": {"pk": "42", "username": "reader"},
                "taken_at": 1786947813,
                "preview_comments": [{
                    "pk": "comment-1",
                    "text": "Excellent list",
                    "comment_like_count": 12,
                    "user": {"username": "commenter"},
                }],
                "carousel_media": [
                    {"pk": "slide-1", "image_versions2": {"candidates": [{"url": "https://cdn/1.jpg", "width": 1080, "height": 1350}]}},
                    {"pk": "slide-2", "image_versions2": {"candidates": [{"url": "https://cdn/2.jpg", "width": 1080, "height": 1350}]}},
                    {"pk": "slide-3", "video_versions": [{"url": "https://cdn/3.mp4", "width": 1080, "height": 1350}]},
                ],
            }],
        }
        normalised = app.normalise_instagram_private_info(payload, "https://www.instagram.com/p/DCarousel01/")
        self.assertEqual(normalised["_type"], "playlist")
        self.assertEqual(normalised["channel"], "reader")
        self.assertEqual(len(normalised["entries"]), 3)
        self.assertEqual(normalised["entries"][0]["thumbnails"][0]["url"], "https://cdn/1.jpg")
        self.assertEqual(normalised["entries"][2]["formats"][0]["url"], "https://cdn/3.mp4")
        self.assertEqual(normalised["comments"][0]["like_count"], 12)

    def test_private_carousel_fetch_uses_authenticated_shortcode_endpoint(self):
        payload = {"items": [{
            "code": "DCarousel02",
            "carousel_media": [
                {"pk": "1", "image_versions2": {"candidates": [{"url": "https://cdn/1.jpg"}]}},
                {"pk": "2", "image_versions2": {"candidates": [{"url": "https://cdn/2.jpg"}]}},
            ],
        }]}
        with tempfile.TemporaryDirectory() as raw:
            cookie_path = app.write_instagram_cookies(json.dumps([
                {"name": "sessionid", "value": "secret", "domain": ".instagram.com", "path": "/"},
                {"name": "csrftoken", "value": "csrf", "domain": ".instagram.com", "path": "/"},
            ]), Path(raw))
            with patch.object(app.requests, "get", return_value=FakeJsonResponse(payload)) as request:
                result = app.fetch_instagram_private_info("https://www.instagram.com/p/DCarousel02/", cookie_path)
            self.assertEqual(len(result["entries"]), 2)
            self.assertIn("/api/v1/media/shortcode/DCarousel02/info/", request.call_args.args[0])
            self.assertEqual(request.call_args.kwargs["cookies"]["sessionid"], "secret")

    def test_nested_html_bootloader_carousel_is_discovered(self):
        payload = {"require": [["RelayPrefetchedStreamCache", "next", [{"items": [{
            "code": "DNested03",
            "carousel_media": [
                {"pk": "1", "image_versions2": {"candidates": [{"url": "https://cdn/1.jpg"}]}},
                {"pk": "2", "image_versions2": {"candidates": [{"url": "https://cdn/2.jpg"}]}},
            ],
        }]}]]]}
        result = app.find_instagram_carousel_info(payload, "https://www.instagram.com/p/DNested03/")
        self.assertEqual(result["id"], "DNested03")
        self.assertEqual(len(result["entries"]), 2)

    def test_route_bootloader_maps_shortcode_to_real_media_id(self):
        page = (
            '{"hostableView":{"props":{"owner_id":"42","media_id":"3949856330472598200"}},'
            '"url":"\\/p\\/DRoute05\\/","params":{"shortcode":"DRoute05"}}'
        )
        self.assertEqual(
            app.instagram_media_id_from_html(page, "https://www.instagram.com/p/DRoute05/"),
            "3949856330472598200",
        )

    def test_gallery_dl_carousel_fallback_preserves_individual_images(self):
        with tempfile.TemporaryDirectory() as raw:
            workdir = Path(raw)
            cookie_path = app.write_instagram_cookies(json.dumps([
                {"name": "sessionid", "value": "secret", "domain": ".instagram.com", "path": "/"},
            ]), workdir)

            def fake_run(command, **_kwargs):
                staging = Path(command[command.index("--directory") + 1])
                staging.mkdir(parents=True, exist_ok=True)
                for index in range(1, 4):
                    (staging / f"{index:02}.jpg").write_bytes(f"image-{index}".encode())
                    (staging / f"{index:02}.json").write_text(json.dumps({
                        "shortcode": "DGallery04",
                        "description": "Three useful images",
                        "username": "creator",
                        "media_id": str(index),
                    }), encoding="utf-8")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            def fake_preview(item, index, preview_dir):
                preview_dir.mkdir(parents=True, exist_ok=True)
                path = preview_dir / f"slide-{index:02}.jpg"
                path.write_bytes(item.read_bytes())
                return path

            def fake_overview(_previews, directory):
                path = directory / "carousel-overview.mp4"
                path.write_bytes(b"video")
                return path

            with patch.object(app.subprocess, "run", side_effect=fake_run), \
                 patch.object(app, "carousel_preview", side_effect=fake_preview), \
                 patch.object(app, "build_carousel_overview", side_effect=fake_overview):
                overview, metadata, items, manifest, previews = app.download_carousel_with_gallery_dl(
                    "https://www.instagram.com/p/DGallery04/", workdir, cookie_path,
                )
            self.assertEqual(metadata["media_type"], "carousel")
            self.assertEqual(metadata["carousel_item_count"], 3)
            self.assertEqual(len(items), 3)
            self.assertEqual(len(previews), 3)
            self.assertTrue(overview.exists())
            self.assertEqual(json.loads(manifest.read_text(encoding="utf-8"))["item_count"], 3)


if __name__ == "__main__":
    unittest.main()
