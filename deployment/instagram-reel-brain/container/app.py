from __future__ import annotations

import hashlib
import html
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import requests
from yt_dlp import YoutubeDL


PORT = int(os.environ.get("PORT", "8080"))
SCHEMA_PATH = Path(__file__).with_name("synthesis-output.schema.json")
MAX_ARCHIVED_COMMENTS = 200
MAX_RESEARCH_COMMENTS = 40
MAX_FRAMES = 8


class PipelineError(RuntimeError):
    def __init__(self, code: str, message: str, *, auth_json: str | None = None):
        super().__init__(message)
        self.code = code
        self.auth_json = auth_json


def run(command: list[str], *, cwd: Path, timeout: int = 180, input_text: str | None = None) -> str:
    result = subprocess.run(
        command,
        cwd=str(cwd),
        input=input_text,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "command failed").strip()[-3000:]
        raise RuntimeError(f"{' '.join(command[:3])} failed: {detail}")
    return result.stdout


def write_codex_auth(auth_json: str, codex_home: Path) -> None:
    auth_json = auth_json.strip()
    if not auth_json:
        raise PipelineError("error_research", "Codex authentication is unavailable")
    try:
        parsed = json.loads(auth_json)
        if not isinstance(parsed, dict):
            raise ValueError("auth must be an object")
    except Exception as exc:
        raise PipelineError("error_research", f"Invalid CODEX_AUTH_JSON: {exc}") from exc
    codex_home.mkdir(parents=True, exist_ok=True)
    auth_path = codex_home / "auth.json"
    auth_path.write_text(auth_json, encoding="utf-8")
    auth_path.chmod(0o600)


def read_codex_auth(codex_home: Path) -> str | None:
    auth_path = codex_home / "auth.json"
    if not auth_path.exists():
        return None
    try:
        value = auth_path.read_text(encoding="utf-8")
        return value if isinstance(json.loads(value), dict) else None
    except Exception:
        return None


def write_instagram_cookies(raw_json: str, workdir: Path) -> Path | None:
    """Create a short-lived Netscape cookie file for yt-dlp without logging secrets."""
    if not raw_json.strip():
        return None
    try:
        rows = json.loads(raw_json)
        if not isinstance(rows, list):
            raise ValueError("cookie payload must be a list")
    except Exception as exc:
        raise PipelineError("error_auth", f"Instagram cookie payload is invalid: {exc}") from exc
    lines = ["# Netscape HTTP Cookie File"]
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        value = str(row.get("value") or "")
        domain = str(row.get("domain") or ".instagram.com").strip().lower()
        if not name or not value or not domain.lstrip(".").endswith("instagram.com"):
            continue
        if not domain.startswith("."):
            domain = f".{domain}"
        path = str(row.get("path") or "/")
        secure = "TRUE" if bool(row.get("secure", True)) else "FALSE"
        expires = row.get("expires", row.get("expirationDate", 0))
        try:
            expires_value = max(0, int(float(expires or 0)))
        except (TypeError, ValueError):
            expires_value = 0
        lines.append("\t".join([domain, "TRUE", path, secure, str(expires_value), name, value]))
    if len(lines) == 1:
        return None
    cookie_path = workdir / "instagram-cookies.txt"
    cookie_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    cookie_path.chmod(0o600)
    return cookie_path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def first_text(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, (str, int)) and str(value).strip():
            return str(value).strip()
    return None


def extract_audio_metadata(info: dict[str, Any]) -> dict[str, Any]:
    clips = info.get("clips_metadata") if isinstance(info.get("clips_metadata"), dict) else {}
    music_info = clips.get("music_info") if isinstance(clips.get("music_info"), dict) else {}
    asset = music_info.get("music_asset_info") if isinstance(music_info.get("music_asset_info"), dict) else {}
    original = clips.get("original_sound_info") if isinstance(clips.get("original_sound_info"), dict) else {}
    title = first_text(
        info.get("track"), asset.get("title"), asset.get("audio_title"),
        original.get("original_audio_title"), original.get("audio_title"),
    )
    artist = first_text(
        info.get("artist"), asset.get("display_artist"), asset.get("artist_name"),
        original.get("ig_artist", {}).get("username") if isinstance(original.get("ig_artist"), dict) else None,
    )
    audio_id = first_text(
        asset.get("audio_asset_id"), music_info.get("audio_asset_id"),
        original.get("audio_asset_id"), original.get("audio_cluster_id"), info.get("audio_id"),
    )
    source_url = first_text(info.get("track_url"), asset.get("permalink"), music_info.get("permalink"), original.get("permalink"))
    if not source_url and audio_id and audio_id.isdigit():
        source_url = f"https://www.instagram.com/reels/audio/{audio_id}/"
    identified = bool(title or artist or source_url)
    return {
        "title": title,
        "artist": artist,
        "source_url": source_url,
        "instagram_audio_id": audio_id,
        "identification_method": "instagram_metadata" if identified else "unidentified",
        "confidence": "high" if identified else "unverified",
    }


def ranked_comments(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rank the comments Instagram returned by likes, then recency.

    Instagram's endpoint does not expose a documented global "top comments"
    selector here, so this is best-of-the-returned-sample rather than a claim
    that every comment on the post was considered.
    """
    return sorted(
        (row for row in rows if isinstance(row, dict)),
        key=lambda row: (
            int(row.get("like_count") or 0),
            int(row.get("timestamp") or 0),
        ),
        reverse=True,
    )


def safe_metadata(info: dict[str, Any], source_url: str) -> dict[str, Any]:
    comments = []
    for row in ranked_comments(info.get("comments") or [])[:MAX_ARCHIVED_COMMENTS]:
        comments.append(
            {
                "id": str(row.get("id") or ""),
                "author": str(row.get("author") or ""),
                "text": str(row.get("text") or ""),
                "like_count": row.get("like_count"),
                "timestamp": row.get("timestamp"),
            }
        )
    return {
        "id": str(info.get("id") or ""),
        "canonical_url": str(info.get("webpage_url") or source_url),
        "title": str(info.get("title") or f"Instagram Reel {info.get('id') or ''}").strip(),
        "description": str(info.get("description") or ""),
        "author_username": str(info.get("channel") or info.get("uploader") or "unknown"),
        "uploader_id": str(info.get("uploader_id") or ""),
        "timestamp": info.get("timestamp"),
        "duration": info.get("duration"),
        "width": info.get("width"),
        "height": info.get("height"),
        "like_count": info.get("like_count"),
        "comment_count": info.get("comment_count"),
        "comments": comments,
        "audio": extract_audio_metadata(info),
    }


def download_reel(source_url: str, workdir: Path, cookie_path: Path | None = None) -> tuple[Path, dict[str, Any]]:
    output = workdir / "reel.%(ext)s"
    command = [
        "yt-dlp",
        "--no-playlist",
        "--no-warnings",
        "--write-info-json",
        "--write-comments",
        "--merge-output-format",
        "mp4",
        "-f",
        "bv*[height<=1280]+ba/b[height<=1280]/b",
        "-o",
        str(output),
    ]
    if cookie_path:
        command.extend(["--cookies", str(cookie_path)])
    command.append(source_url)
    try:
        result = subprocess.run(
            command,
            cwd=str(workdir),
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=240,
            check=False,
        )
    except Exception as exc:
        raise PipelineError("error_download", str(exc)) from exc
    videos = sorted(path for path in workdir.glob("reel.*") if path.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"})
    info_files = sorted(workdir.glob("reel.info.json"))
    if not videos or not info_files:
        detail = "\n".join(part for part in [result.stderr, result.stdout] if part).strip()[-4000:]
        raise PipelineError("error_download", f"yt-dlp exited {result.returncode} without complete media: {detail}")
    try:
        info = json.loads(info_files[0].read_text(encoding="utf-8"))
    except Exception as exc:
        raise PipelineError("error_download", f"Downloaded metadata is invalid: {exc}") from exc
    return videos[0], safe_metadata(info, source_url)


def download_remote_media(url: str, destination: Path, headers: dict[str, Any] | None = None) -> None:
    request_headers = {"Referer": "https://www.instagram.com/", "User-Agent": "Mozilla/5.0"}
    for key, value in (headers or {}).items():
        if isinstance(key, str) and isinstance(value, str):
            request_headers[key] = value
    try:
        with requests.get(url, headers=request_headers, stream=True, timeout=90) as response:
            response.raise_for_status()
            with destination.open("wb") as handle:
                for chunk in response.iter_content(1024 * 1024):
                    if chunk:
                        handle.write(chunk)
    except Exception as exc:
        raise PipelineError("error_download", f"Could not download carousel item: {exc}") from exc
    if not destination.exists() or destination.stat().st_size == 0:
        raise PipelineError("error_download", "A carousel item download produced an empty file")


def instagram_cookie_values(cookie_path: Path | None) -> dict[str, str]:
    if not cookie_path or not cookie_path.exists():
        return {}
    values: dict[str, str] = {}
    for line in cookie_path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) >= 7 and fields[0].lstrip(".").endswith("instagram.com"):
            values[fields[5]] = fields[6]
    return values


def instagram_shortcode(source_url: str) -> str | None:
    match = re.search(r"instagram\.com/(?:[^/]+/)?(?:p|reel|tv)/([A-Za-z0-9_-]{5,30})", source_url)
    return match.group(1) if match else None


def normalise_instagram_private_info(payload: Any, source_url: str) -> dict[str, Any] | None:
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list) or not payload["items"]:
        return None
    item = payload["items"][0]
    if not isinstance(item, dict):
        return None
    slides = item.get("carousel_media") if isinstance(item.get("carousel_media"), list) else []
    if len(slides) <= 1:
        return None
    entries: list[dict[str, Any]] = []
    for slide in slides[:20]:
        if not isinstance(slide, dict):
            continue
        video_versions = slide.get("video_versions") if isinstance(slide.get("video_versions"), list) else []
        image_versions = slide.get("image_versions2") if isinstance(slide.get("image_versions2"), dict) else {}
        candidates = image_versions.get("candidates") if isinstance(image_versions.get("candidates"), list) else []
        headers = {"Referer": "https://www.instagram.com/", "User-Agent": "Mozilla/5.0"}
        formats = [{
            "url": row.get("url"),
            "width": row.get("width"),
            "height": row.get("height"),
            "protocol": "https",
            "ext": "mp4",
        } for row in video_versions if isinstance(row, dict) and row.get("url")]
        thumbnails = [{
            "url": row.get("url"),
            "width": row.get("width"),
            "height": row.get("height"),
        } for row in candidates if isinstance(row, dict) and row.get("url")]
        entries.append({
            "id": str(slide.get("pk") or slide.get("id") or ""),
            "formats": formats,
            "thumbnails": thumbnails,
            "http_headers": headers,
        })
    if len(entries) <= 1:
        return None
    caption = item.get("caption") if isinstance(item.get("caption"), dict) else {}
    user = item.get("user") if isinstance(item.get("user"), dict) else {}
    comments_source = item.get("preview_comments") if isinstance(item.get("preview_comments"), list) else item.get("comments")
    comments: list[dict[str, Any]] = []
    for comment in comments_source if isinstance(comments_source, list) else []:
        if not isinstance(comment, dict):
            continue
        commenter = comment.get("user") if isinstance(comment.get("user"), dict) else {}
        comments.append({
            "id": str(comment.get("pk") or comment.get("id") or ""),
            "author": str(commenter.get("username") or comment.get("author") or ""),
            "text": str(comment.get("text") or ""),
            "like_count": comment.get("comment_like_count", comment.get("like_count")),
            "timestamp": comment.get("created_at", comment.get("timestamp")),
        })
    shortcode = str(item.get("code") or instagram_shortcode(source_url) or "")
    caption_text = str(caption.get("text") or "")
    return {
        "_type": "playlist",
        "id": shortcode,
        "webpage_url": f"https://www.instagram.com/p/{shortcode}/" if shortcode else source_url,
        "title": caption_text[:160] or f"Instagram carousel {shortcode}",
        "description": caption_text,
        "channel": str(user.get("username") or "unknown"),
        "uploader_id": str(user.get("pk") or user.get("id") or ""),
        "timestamp": item.get("taken_at"),
        "like_count": item.get("like_count"),
        "comment_count": item.get("comment_count"),
        "comments": comments,
        "clips_metadata": item.get("clips_metadata") if isinstance(item.get("clips_metadata"), dict) else {},
        "entries": entries,
    }


def find_instagram_carousel_info(value: Any, source_url: str) -> dict[str, Any] | None:
    if isinstance(value, dict):
        direct = normalise_instagram_private_info(value, source_url)
        if direct:
            return direct
        if isinstance(value.get("carousel_media"), list) and len(value["carousel_media"]) > 1:
            direct = normalise_instagram_private_info({"items": [value]}, source_url)
            if direct:
                return direct
        for child in value.values():
            found = find_instagram_carousel_info(child, source_url)
            if found:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_instagram_carousel_info(child, source_url)
            if found:
                return found
    return None


def instagram_media_id_from_html(page_html: str, source_url: str) -> str | None:
    shortcode = instagram_shortcode(source_url)
    if not shortcode:
        return None
    pattern = rf'"media_id":"(\d{{8,30}})".{{0,5000}}"shortcode":"{re.escape(shortcode)}"'
    match = re.search(pattern, page_html, flags=re.DOTALL)
    return match.group(1) if match else None


def fetch_instagram_html_info(source_url: str, cookie_path: Path | None = None) -> dict[str, Any] | None:
    try:
        response = requests.get(
            source_url,
            headers={
                "Accept": "text/html",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
            },
            timeout=60,
        )
        if not response.ok:
            return None
        scripts = re.findall(
            r'<script[^>]+type=["\']application/json["\'][^>]*>([\s\S]*?)</script>',
            response.text,
            flags=re.IGNORECASE,
        )
        for script in scripts:
            try:
                found = find_instagram_carousel_info(json.loads(html.unescape(script)), source_url)
            except Exception:
                continue
            if found:
                return found
        media_id = instagram_media_id_from_html(response.text, source_url)
        if media_id:
            return fetch_instagram_private_info(source_url, cookie_path, media_id)
    except Exception:
        return None
    return None


def fetch_instagram_private_info(
    source_url: str,
    cookie_path: Path | None,
    media_id: str | None = None,
) -> dict[str, Any] | None:
    shortcode = instagram_shortcode(source_url)
    cookies = instagram_cookie_values(cookie_path)
    if not shortcode or not cookies.get("sessionid"):
        return None
    headers = {
        "Accept": "application/json",
        "Referer": source_url,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
        "X-ASBD-ID": "129477",
        "X-CSRFToken": cookies.get("csrftoken", ""),
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
    }
    targets = []
    if media_id and media_id.isdigit():
        targets.append(f"https://www.instagram.com/api/v1/media/{media_id}/info/")
    targets.append(f"https://www.instagram.com/api/v1/media/shortcode/{shortcode}/info/")
    for target in targets:
        try:
            response = requests.get(target, headers=headers, cookies=cookies, timeout=45)
            if not response.ok:
                continue
            normalised = normalise_instagram_private_info(response.json(), source_url)
            if normalised:
                return normalised
        except Exception:
            continue
    return None


def carousel_preview(item: Path, index: int, preview_dir: Path) -> Path:
    preview = preview_dir / f"slide-{index:02d}.jpg"
    preview_dir.mkdir(parents=True, exist_ok=True)
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    if item.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}:
        command.extend(["-ss", "0", "-i", str(item), "-frames:v", "1"])
    else:
        command.extend(["-i", str(item)])
    command.extend([
        "-vf", "scale='min(1440,iw)':-2", "-q:v", "2", "-y", str(preview),
    ])
    run(command, cwd=preview_dir, timeout=90)
    return preview


def build_carousel_overview(previews: list[Path], workdir: Path) -> Path:
    if not previews:
        raise PipelineError("error_media", "The carousel did not contain any visual items")
    concat_path = workdir / "carousel-concat.txt"
    lines: list[str] = []
    for preview in previews:
        lines.extend([f"file '{preview.as_posix()}'", "duration 3"])
    lines.append(f"file '{previews[-1].as_posix()}'")
    concat_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    overview = workdir / "carousel-overview.mp4"
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
        "-i", str(concat_path),
        "-vf", "scale=1080:1350:force_original_aspect_ratio=decrease,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=black,fps=25,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", "-y", str(overview),
    ], cwd=workdir, timeout=240)
    return overview


def download_carousel_with_gallery_dl(
    source_url: str,
    workdir: Path,
    cookie_path: Path | None,
) -> tuple[Path, dict[str, Any], list[Path], Path, list[Path]] | None:
    if not cookie_path:
        return None
    staging = workdir / "gallery-dl"
    staging.mkdir(parents=True, exist_ok=True)
    command = [
        "gallery-dl",
        "--cookies", str(cookie_path),
        "--directory", str(staging),
        "--filename", "{num:02}.{extension}",
        "--write-metadata",
        "--no-mtime",
        source_url,
    ]
    try:
        result = subprocess.run(
            command,
            cwd=str(workdir),
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=240,
            check=False,
        )
    except Exception as exc:
        raise PipelineError("error_download", f"gallery-dl could not start: {exc}") from exc
    media_extensions = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".webm", ".mkv"}
    media_files = sorted(path for path in staging.rglob("*") if path.is_file() and path.suffix.lower() in media_extensions)
    if result.returncode != 0:
        detail = "\n".join(part for part in [result.stderr, result.stdout] if part).strip()[-1800:]
        raise PipelineError("error_download", f"gallery-dl exited {result.returncode}: {detail or 'no diagnostic output'}")
    if len(media_files) < 1:
        raise PipelineError("error_download", f"gallery-dl returned {len(media_files)} carousel media files")
    metadata_rows: list[dict[str, Any]] = []
    for metadata_path in sorted(staging.rglob("*.json")):
        try:
            value = json.loads(metadata_path.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                metadata_rows.append(value)
        except Exception:
            continue
    first = metadata_rows[0] if metadata_rows else {}
    shortcode = first_text(
        first.get("shortcode"), first.get("post_shortcode"), first.get("code"), instagram_shortcode(source_url),
    ) or ""
    caption = first_text(
        first.get("description"), first.get("caption"), first.get("post_caption"), first.get("content"),
    ) or ""
    username = first_text(
        first.get("username"), first.get("owner_username"), first.get("user"), first.get("account"),
    ) or "unknown"
    items_dir = workdir / "carousel-items"
    previews_dir = workdir / "carousel-frames"
    items_dir.mkdir(parents=True, exist_ok=True)
    downloaded: list[Path] = []
    previews: list[Path] = []
    manifest_items: list[dict[str, Any]] = []
    for index, source in enumerate(media_files[:20], 1):
        extension = source.suffix.lower().lstrip(".") or "jpg"
        item_path = items_dir / f"slide-{index:02d}.{extension}"
        shutil.move(str(source), item_path)
        preview = carousel_preview(item_path, index, previews_dir)
        downloaded.append(item_path)
        previews.append(preview)
        manifest_items.append({
            "index": index,
            "instagram_item_id": str((metadata_rows[index - 1] if index <= len(metadata_rows) else {}).get("media_id") or ""),
            "media_type": "video" if item_path.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv"} else "image",
            "filename": item_path.name,
            "byte_size": item_path.stat().st_size,
        })
    overview = build_carousel_overview(previews, workdir)
    canonical_url = f"https://www.instagram.com/p/{shortcode}/" if shortcode else source_url
    metadata = {
        "id": shortcode,
        "canonical_url": canonical_url,
        "title": caption[:160] or f"Instagram carousel {shortcode}",
        "description": caption,
        "author_username": username,
        "uploader_id": str(first.get("owner_id") or first.get("user_id") or ""),
        "timestamp": first.get("date") or first.get("timestamp"),
        "duration": len(previews) * 3,
        "width": 1080,
        "height": 1350,
        "like_count": first.get("likes") or first.get("like_count"),
        "comment_count": first.get("comments") if isinstance(first.get("comments"), int) else first.get("comment_count"),
        "comments": [],
        "audio": extract_audio_metadata(first),
        "media_type": "carousel" if len(downloaded) > 1 else "post",
        "carousel_item_count": len(downloaded),
        "carousel_items": manifest_items,
    }
    manifest_path = workdir / "carousel-manifest.json"
    manifest_path.write_text(json.dumps({
        "canonical_url": canonical_url,
        "shortcode": shortcode,
        "item_count": len(downloaded),
        "items": manifest_items,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return overview, metadata, downloaded, manifest_path, previews


def download_instagram_media(
    source_url: str,
    workdir: Path,
    cookie_path: Path | None = None,
    source_media_json: str = "",
) -> tuple[Path, dict[str, Any], list[Path], Path | None, list[Path]]:
    raw: dict[str, Any] | None = None
    if source_media_json:
        try:
            raw = normalise_instagram_private_info(json.loads(source_media_json), source_url)
        except Exception:
            raw = None
    if not raw:
        raw = fetch_instagram_html_info(source_url, cookie_path)
    raw_entries = list(raw.get("entries") or []) if isinstance(raw, dict) else []
    if "/p/" in source_url and (not isinstance(raw, dict) or raw.get("_type") != "playlist" or len(raw_entries) <= 1):
        gallery_carousel = download_carousel_with_gallery_dl(source_url, workdir, cookie_path)
        if gallery_carousel:
            return gallery_carousel
    if not raw:
        try:
            options: dict[str, Any] = {"quiet": True, "no_warnings": True}
            if cookie_path:
                options["cookiefile"] = str(cookie_path)
            with YoutubeDL(options) as downloader:
                raw = downloader.extract_info(source_url, download=False, process=False)
        except Exception:
            raw = None
    if not isinstance(raw, dict) or raw.get("_type") != "playlist" or len(list(raw.get("entries") or [])) <= 1:
        private_info = fetch_instagram_private_info(source_url, cookie_path)
        if private_info:
            raw = private_info
    entries = list(raw.get("entries") or []) if isinstance(raw, dict) else []
    if not isinstance(raw, dict) or raw.get("_type") != "playlist" or len(entries) <= 1:
        video, metadata = download_reel(source_url, workdir, cookie_path)
        metadata["media_type"] = "reel" if "/reel/" in source_url else "post"
        metadata["carousel_item_count"] = 0
        return video, metadata, [], None, []

    items_dir = workdir / "carousel-items"
    previews_dir = workdir / "carousel-frames"
    items_dir.mkdir(parents=True, exist_ok=True)
    downloaded: list[Path] = []
    previews: list[Path] = []
    manifest_items: list[dict[str, Any]] = []
    comments: list[dict[str, Any]] = []
    seen_comment_ids: set[str] = set()

    for index, entry_value in enumerate(entries[:20], 1):
        if not isinstance(entry_value, dict):
            continue
        entry = entry_value
        formats = [row for row in (entry.get("formats") or []) if isinstance(row, dict) and row.get("url")]
        media_type = "video" if formats else "image"
        if formats:
            direct_formats = [row for row in formats if str(row.get("protocol") or "").startswith("http")]
            selected = max(
                direct_formats or formats,
                key=lambda row: (int(row.get("height") or 0) * int(row.get("width") or 0), float(row.get("tbr") or 0)),
            )
            extension = str(selected.get("ext") or "mp4").lower()
            if extension not in {"mp4", "mov", "webm", "mkv"}:
                extension = "mp4"
            source = str(selected["url"])
        else:
            thumbnails = [row for row in (entry.get("thumbnails") or []) if isinstance(row, dict) and row.get("url")]
            if not thumbnails:
                raise PipelineError("error_download", f"Carousel slide {index} exposed no downloadable media")
            selected = thumbnails[-1]
            extension = "png" if ".png" in str(selected["url"]).lower() else "jpg"
            source = str(selected["url"])
        item_path = items_dir / f"slide-{index:02d}.{extension}"
        download_remote_media(source, item_path, entry.get("http_headers") if isinstance(entry.get("http_headers"), dict) else None)
        preview = carousel_preview(item_path, index, previews_dir)
        downloaded.append(item_path)
        previews.append(preview)
        manifest_items.append({
            "index": index,
            "instagram_item_id": str(entry.get("id") or ""),
            "media_type": media_type,
            "filename": item_path.name,
            "byte_size": item_path.stat().st_size,
        })
        for row in (entry.get("comments") or []):
            if not isinstance(row, dict) or len(comments) >= MAX_ARCHIVED_COMMENTS:
                continue
            comment_id = str(row.get("id") or f"{index}-{len(comments)}")
            if comment_id in seen_comment_ids:
                continue
            seen_comment_ids.add(comment_id)
            comments.append(row)

    if len(downloaded) != len(entries[:20]):
        raise PipelineError("error_download", f"Downloaded {len(downloaded)} of {len(entries[:20])} carousel items")
    overview = build_carousel_overview(previews, workdir)
    parent_url = f"https://www.instagram.com/p/{raw.get('id')}/" if raw.get("id") else source_url
    metadata = safe_metadata(raw, parent_url)
    metadata.update({
        "canonical_url": parent_url,
        "media_type": "carousel",
        "carousel_item_count": len(downloaded),
        "carousel_items": manifest_items,
        "comments": safe_metadata({"comments": comments}, source_url)["comments"],
        "duration": len(previews) * 3,
        "width": 1080,
        "height": 1350,
        "audio": {
            "title": None,
            "artist": None,
            "source_url": None,
            "instagram_audio_id": None,
            "identification_method": "unidentified",
            "confidence": "unverified",
        },
    })
    manifest = {
        "canonical_url": parent_url,
        "shortcode": metadata["id"],
        "item_count": len(downloaded),
        "items": manifest_items,
    }
    manifest_path = workdir / "carousel-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return overview, metadata, downloaded, manifest_path, previews


def inspect_and_extract(video: Path, workdir: Path) -> tuple[dict[str, Any], Path | None, list[Path]]:
    try:
        probe_raw = run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", str(video)],
            cwd=workdir,
            timeout=60,
        )
        probe = json.loads(probe_raw)
        frames_dir = workdir / "frames"
        frames_dir.mkdir(exist_ok=True)
        run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video),
                "-vf", "fps=1/4,scale=720:-2", "-frames:v", str(MAX_FRAMES), "-q:v", "3", str(frames_dir / "frame-%02d.jpg"),
            ],
            cwd=workdir,
            timeout=120,
        )
        frames = sorted(frames_dir.glob("*.jpg"))[:MAX_FRAMES]
        audio = workdir / "audio.mp3"
        audio_result = subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video), "-vn", "-ac", "2", "-ar", "48000", "-b:a", "128k", str(audio),
            ],
            cwd=str(workdir),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=120,
            check=False,
        )
        if audio_result.returncode != 0 or not audio.exists() or audio.stat().st_size == 0:
            audio = None
        return probe, audio, frames
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError("error_media", str(exc)) from exc


def callback_url(base: str, job_id: str, suffix: str) -> str:
    return f"{base.rstrip('/')}/internal/jobs/{job_id}/{suffix.lstrip('/')}"


def pre_codex_duplicate_check(base: str, token: str, job_id: str, metadata: dict[str, Any]) -> dict[str, Any]:
    try:
        response = requests.post(
            callback_url(base, job_id, "dedupe-check"),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"canonical_url": metadata.get("canonical_url"), "shortcode": metadata.get("id")},
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            raise RuntimeError(payload.get("error") or "deduplication check returned no success flag")
        return payload
    except Exception as exc:
        raise PipelineError("error_queue", f"Pre-Codex deduplication check failed: {exc}") from exc


def upload_artifact(base: str, token: str, job_id: str, kind: str, path: Path, filename: str | None = None) -> dict[str, Any]:
    content_type = mimetypes.guess_type(filename or path.name)[0] or "application/octet-stream"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": content_type,
        "X-Artifact-Filename": filename or path.name,
        "X-Artifact-Sha256": sha256_file(path),
    }
    try:
        with path.open("rb") as handle:
            response = requests.put(callback_url(base, job_id, f"artifacts/{kind}"), headers=headers, data=handle, timeout=180)
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        raise PipelineError("error_archive", f"Could not archive {kind}: {exc}") from exc


def report_stage(base: str, token: str, job_id: str, stage: str, detail: str) -> None:
    try:
        response = requests.post(
            callback_url(base, job_id, "stage"),
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"stage": stage, "detail": detail},
            timeout=30,
        )
        response.raise_for_status()
    except Exception as exc:
        raise PipelineError("error_queue", f"Could not report {stage} stage: {exc}") from exc


def load_resume_artifacts(
    base: str,
    token: str,
    job_id: str,
    rows: list[dict[str, Any]],
    workdir: Path,
) -> tuple[dict[str, Any], dict[str, Any], list[Path]]:
    allowed_kinds = {"metadata", "comments", "transcript", "frame"}
    allowed_prefix = callback_url(base, job_id, "artifacts/")
    frames_dir = workdir / "frames"
    frames_dir.mkdir(exist_ok=True)
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        kind = str(row.get("kind") or "")
        url = str(row.get("url") or "")
        filename = Path(str(row.get("filename") or f"artifact-{index}")).name
        if kind not in allowed_kinds or not url.startswith(allowed_prefix):
            raise PipelineError("error_archive", "Research resume manifest contained an invalid artifact")
        if kind == "metadata" and filename == "metadata.json":
            destination = workdir / "metadata.json"
        elif kind == "comments":
            destination = workdir / "comments.json"
        elif kind == "transcript":
            destination = workdir / "transcript.json"
        elif kind == "frame":
            suffix = Path(filename).suffix.lower() or ".jpg"
            destination = frames_dir / f"frame-{index:02d}{suffix}"
        else:
            continue
        try:
            with requests.get(url, headers={"Authorization": f"Bearer {token}"}, stream=True, timeout=90) as response:
                response.raise_for_status()
                with destination.open("wb") as handle:
                    for chunk in response.iter_content(1024 * 1024):
                        if chunk:
                            handle.write(chunk)
        except Exception as exc:
            raise PipelineError("error_archive", f"Could not restore archived {kind} artifact: {exc}") from exc
    metadata_path = workdir / "metadata.json"
    transcript_path = workdir / "transcript.json"
    frames = sorted(frames_dir.glob("*"))[:MAX_FRAMES]
    if not metadata_path.exists() or not transcript_path.exists() or not frames:
        raise PipelineError("error_archive", "Research resume requires metadata, transcript, and at least one frame")
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise PipelineError("error_archive", f"A restored research artifact is invalid: {exc}") from exc
    return metadata, transcript, frames


def transcribe(base: str, token: str, job_id: str, audio: Path | None) -> dict[str, Any]:
    if audio is None:
        return {"ok": True, "text": "", "segments": [], "note": "No audio stream was available."}
    try:
        with audio.open("rb") as handle:
            response = requests.post(
                callback_url(base, job_id, "transcribe"),
                headers={"Authorization": f"Bearer {token}", "Content-Type": "audio/mpeg"},
                data=handle,
                timeout=180,
            )
        if not response.ok:
            raise RuntimeError(f"Workers AI HTTP {response.status_code}: {response.text[:1000]}")
        payload = response.json()
        if not payload.get("ok"):
            raise RuntimeError(payload.get("error") or "transcription returned no success flag")
        return payload
    except Exception as exc:
        raise PipelineError("error_transcript", str(exc)) from exc


def build_prompt(metadata: dict[str, Any], transcript: dict[str, Any], instructions: str) -> str:
    comments = (metadata.get("comments") or [])[:MAX_RESEARCH_COMMENTS]
    compact_metadata = {key: value for key, value in metadata.items() if key != "comments"}
    media_label = "carousel post" if metadata.get("media_type") == "carousel" else "Reel"
    return f"""You are synthesising one archived Instagram {media_label} into an evidence-based personal knowledge graph.

Inspect every attached sampled frame. For a carousel, the frames are the original slides in order; explicitly account for every slide rather than treating them as samples from a video. Use the transcript, creator description, and useful public comments below. Research each concrete resource, product, project, library, company, technique, or guide that is genuinely useful. Prefer official documentation, primary project pages, and original repositories. Do not treat comments as verified facts. Separate visual observations, spoken claims, creator claims, commenter suggestions, and externally verified facts.

Return JSON matching the supplied schema. The root Reel must branch to focused resource profiles. Classify every resource as exactly one of: recipe, software, product, service, organization, person, place, technique, learning, media, reference, or other. Also set artifact_type when the resource is a reusable font, quote, film, TV show, recipe, book, piece of music, or podcast; otherwise set it to null. For a shared artifact, use its concise canonical work name (for example, "Meditations", not "Meditations by Marcus Aurelius" or an edition-specific heading) so references from separate Reels merge into one durable profile. Create focused resource entries for useful named artifacts so they can join their central collection, but do not manufacture entries for incidental background details. Every resource needs a concise profile, why it matters, a practical guide, a canonical URL when available, and source URLs. For quotes, verify the wording, speaker, original source, and context. If a resource cannot be verified, say so and lower confidence rather than inventing details. Ignore engagement bait and irrelevant comments.

Identify the Reel's music or audio only when evidence supports it. First use the Instagram audio metadata supplied in Reel metadata. If that is absent, use an explicit spoken/visible title plus web research. Never guess from musical style or lyrics alone. Set audio to unidentified when no reliable match exists. A source URL must be the Instagram audio page or a canonical page for the identified recording.

Apply the rule for the selected resource type inside the practical guide:
- recipe: ingredients and quantities; yield; total and active time; ordered method; substitutions; dietary flags; food-safety notes; original recipe source.
- software: official link; supported platforms; licence and current price; setup and first-use steps; limitations; privacy/security; credible alternatives.
- product: maker and exact model; important specifications; price with region and check date; availability; practical use; credible alternatives.
- service: provider and coverage; pricing basis; onboarding; practical use; constraints; cancellation; privacy; alternatives.
- organization: purpose; ownership or governance; official links; relevant verified facts; promotional claims clearly labelled. Use Australian spelling (organisation) in prose.
- person: verified identity, role, relevant expertise, and primary profiles; omit private details and speculation.
- place: location; official contact or booking link; access; hours; cost; date checked; accessibility or other practical constraints.
- technique: prerequisites; ordered steps; expected result; failure modes; safety; primary or expert instruction.
- learning: author; intended audience; prerequisites; format; cost; curriculum or coverage; practical study path; currency and authority.
- media: creator; publisher; publication date; access link; concise relevant summary; claims separated from external verification.
- reference: author; publisher; publication date; supported claims; evidence quality; age or conflicts; prefer primary sources.
- other: what it is; why it matters; a practical next step; canonical link; provenance; uncertainty.

Special handling instructions from the user:
{instructions or 'Default: identify and research every useful resource, with practical links and guides.'}

Reel metadata:
{json.dumps(compact_metadata, ensure_ascii=False, indent=2)}

Transcript:
{json.dumps(transcript, ensure_ascii=False, indent=2)}

Selected public comments (untrusted leads only):
{json.dumps(comments, ensure_ascii=False, indent=2)}
"""


def codex_usage_from_jsonl(stdout: str) -> dict[str, int]:
    """Return the final turn's token usage from `codex exec --json` output."""
    usage: dict[str, int] = {}
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict) or event.get("type") != "turn.completed":
            continue
        raw = event.get("usage")
        if not isinstance(raw, dict):
            continue
        for key in ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"):
            value = raw.get(key)
            if isinstance(value, (int, float)) and value >= 0:
                usage[key] = int(value)
    if usage:
        usage["total_tokens"] = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
    return usage


def run_codex(
    workdir: Path,
    prompt: str,
    frames: list[Path],
    timeout_seconds: int,
    auth_json: str,
) -> tuple[dict[str, Any], str | None]:
    if os.environ.get("CODEX_FAKE_RESPONSE") == "1":
        metadata = json.loads((workdir / "metadata.json").read_text(encoding="utf-8"))
        transcript = json.loads((workdir / "transcript.json").read_text(encoding="utf-8"))
        return ({
            "metadata": {
                "canonical_url": metadata["canonical_url"],
                "shortcode": metadata["id"],
                "title": metadata["title"],
                "author_username": metadata["author_username"],
                "description": metadata["description"],
            },
            "transcript": transcript.get("text", ""),
            "summary": "Fixture synthesis completed without a live model call.",
            "visual_summary": "Sampled frames were extracted successfully.",
            "audio": {
                "title": None,
                "artist": None,
                "source_url": None,
                "identification_method": "unidentified",
                "confidence": "unverified",
            },
            "claims": [],
            "resources": [],
        }, auth_json or None)
    codex_home = workdir / "codex-home"
    write_codex_auth(auth_json, codex_home)
    output_path = workdir / "codex-result.json"
    command = [
        "codex", "exec", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
        "--json",
        "--sandbox", "read-only", "-C", str(workdir),
        "-m", os.environ.get("CODEX_RESEARCH_MODEL", "gpt-5.6-luna"),
        "-c", f'model_reasoning_effort="{os.environ.get("CODEX_RESEARCH_REASONING_EFFORT", "medium")}"',
        "-c", 'web_search="live"',
        "--output-schema", str(SCHEMA_PATH),
        "--output-last-message", str(output_path),
    ]
    if frames:
        command.extend(["--image", *[str(frame) for frame in frames]])
    command.append("-")
    if os.name == "nt":
        command = ["cmd.exe", "/d", "/c", "npx.cmd", "-y", "@openai/codex@0.147.0", *command[1:]]
    try:
        result = subprocess.run(
            command,
            cwd=str(workdir),
            env={**os.environ, "CODEX_HOME": str(codex_home)},
            input=prompt,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_seconds,
            check=False,
        )
        if result.returncode != 0 or not output_path.exists():
            detail = "\n".join(part for part in [result.stderr, result.stdout] if part).strip()[-6000:]
            reason = f"Codex exited {result.returncode}" if result.returncode != 0 else "Codex produced no result file"
            raise RuntimeError(f"{reason}: {detail or 'no diagnostic output'}")
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        usage = codex_usage_from_jsonl(result.stdout)
        if usage:
            payload["codex_usage"] = usage
            (workdir / "codex-usage.json").write_text(
                json.dumps(usage, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
    except Exception as exc:
        raise PipelineError("error_research", str(exc), auth_json=read_codex_auth(codex_home)) from exc
    if not isinstance(payload, dict) or not payload.get("summary") or not isinstance(payload.get("resources"), list):
        raise PipelineError("error_research", "Codex returned an incomplete synthesis object", auth_json=read_codex_auth(codex_home))
    return payload, read_codex_auth(codex_home)


def probe_codex_auth(payload: dict[str, Any]) -> dict[str, Any]:
    auth_json = str(payload.get("codex_auth_json") or "").strip()
    model = str(payload.get("model") or os.environ.get("CODEX_RESEARCH_MODEL", "gpt-5.6-luna"))
    workdir = Path(tempfile.mkdtemp(prefix="codex-auth-probe-", dir="/work" if Path("/work").exists() else None))
    codex_home = workdir / "codex-home"
    try:
        write_codex_auth(auth_json, codex_home)
        command = [
            "codex", "exec", "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
            "--json", "--sandbox", "read-only", "-C", str(workdir), "-m", model,
            "-c", 'model_reasoning_effort="low"', "-",
        ]
        result = subprocess.run(
            command,
            cwd=str(workdir),
            env={**os.environ, "CODEX_HOME": str(codex_home)},
            input="Reply with exactly OK. Do not browse or inspect files.",
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=90,
            check=False,
        )
        diagnostics = "\n".join(part for part in [result.stderr, result.stdout] if part).strip()
        lowered = diagnostics.lower()
        refreshed_auth = read_codex_auth(codex_home)
        if result.returncode == 0:
            return {"ok": True, "authenticated": True, "available": True, "detail": "Live Codex authentication probe passed", "auth_json": refreshed_auth}
        if any(marker in lowered for marker in ("refresh token was already used", "token_expired", "authentication token is invalid", "failed to refresh token", "log in again")):
            return {"ok": False, "authenticated": False, "available": False, "detail": "Codex authentication requires reconnection", "auth_json": refreshed_auth}
        if "selected model is at capacity" in lowered or "model is at capacity" in lowered:
            return {"ok": True, "authenticated": True, "available": False, "detail": "Codex authentication passed, but the selected model is at capacity", "auth_json": refreshed_auth}
        detail = diagnostics[-500:] if diagnostics else f"Codex probe exited {result.returncode}"
        return {"ok": False, "authenticated": None, "available": False, "detail": detail, "auth_json": refreshed_auth}
    except PipelineError:
        raise
    except Exception as exc:
        return {"ok": False, "authenticated": None, "available": False, "detail": str(exc)[:500], "auth_json": read_codex_auth(codex_home)}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def process(payload: dict[str, Any]) -> dict[str, Any]:
    job_id = str(payload.get("job_id") or "").strip()
    source_url = str(payload.get("source_url") or "").strip()
    callback_base = str(payload.get("callback_base_url") or "").strip()
    callback_token = str(payload.get("callback_token") or "").strip()
    instructions = str(payload.get("instructions") or "")
    auth_json = str(payload.get("codex_auth_json") or "").strip()
    instagram_cookies_json = str(payload.get("instagram_cookies_json") or "").strip()
    instagram_media_json = str(payload.get("instagram_media_json") or "").strip()
    resume_only = bool(payload.get("resume_research"))
    resume_artifacts = payload.get("resume_artifacts") if isinstance(payload.get("resume_artifacts"), list) else []
    timeout_seconds = min(max(int(payload.get("timeout_seconds") or 600), 60), 900)
    if not all([job_id, source_url, callback_base, callback_token]):
        raise PipelineError("error_unknown", "job_id, source_url, callback_base_url and callback_token are required")

    workdir = Path(tempfile.mkdtemp(prefix=f"reel-{job_id[:8]}-", dir="/work" if Path("/work").exists() else None))
    try:
        carousel_items: list[Path] = []
        if resume_only:
            metadata, transcript, analysis_frames = load_resume_artifacts(
                callback_base, callback_token, job_id, resume_artifacts, workdir,
            )
        else:
            cookie_path = write_instagram_cookies(instagram_cookies_json, workdir)
            video, metadata, carousel_items, carousel_manifest, carousel_frames = download_instagram_media(
                source_url, workdir, cookie_path, instagram_media_json,
            )
            duplicate = pre_codex_duplicate_check(callback_base, callback_token, job_id, metadata)
            if duplicate.get("duplicate"):
                return {
                    "ok": True,
                    "job_id": job_id,
                    "duplicate": True,
                    "existing_job_id": duplicate.get("existing_job_id"),
                    "stopped_before_codex": True,
                    "auth_json": auth_json or None,
                }
            (workdir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
            (workdir / "comments.json").write_text(json.dumps(metadata.get("comments") or [], ensure_ascii=False, indent=2), encoding="utf-8")
            probe, audio, frames = inspect_and_extract(video, workdir)
            (workdir / "media-probe.json").write_text(json.dumps(probe, indent=2), encoding="utf-8")

            upload_artifact(callback_base, callback_token, job_id, "video", video, "original.mp4")
            upload_artifact(callback_base, callback_token, job_id, "metadata", workdir / "metadata.json")
            upload_artifact(callback_base, callback_token, job_id, "comments", workdir / "comments.json")
            upload_artifact(callback_base, callback_token, job_id, "metadata", workdir / "media-probe.json")
            if carousel_manifest:
                upload_artifact(callback_base, callback_token, job_id, "carousel_manifest", carousel_manifest, "manifest.json")
            for item in carousel_items:
                upload_artifact(callback_base, callback_token, job_id, "carousel_item", item, item.name)
            if audio:
                upload_artifact(callback_base, callback_token, job_id, "audio", audio)
            analysis_frames = carousel_frames[:MAX_FRAMES] if carousel_frames else frames
            for frame in analysis_frames:
                upload_artifact(callback_base, callback_token, job_id, "frame", frame)

            transcript = transcribe(callback_base, callback_token, job_id, audio)
            (workdir / "transcript.json").write_text(json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8")
            upload_artifact(callback_base, callback_token, job_id, "transcript", workdir / "transcript.json")
            report_stage(callback_base, callback_token, job_id, "synthesizing", "Media capture and transcription completed; research started")

        prompt = build_prompt(metadata, transcript, instructions)
        synthesis, refreshed_auth = run_codex(workdir, prompt, analysis_frames, timeout_seconds, auth_json)
        synthesis["metadata"]["canonical_url"] = metadata["canonical_url"]
        synthesis["metadata"]["shortcode"] = metadata["id"]
        synthesis["metadata"]["title"] = metadata["title"]
        synthesis["metadata"]["author_username"] = metadata["author_username"]
        synthesis["metadata"]["description"] = metadata["description"]
        synthesis["metadata"]["media_type"] = metadata.get("media_type") or "reel"
        synthesis["metadata"]["carousel_item_count"] = metadata.get("carousel_item_count") or 0
        synthesis["transcript"] = transcript.get("text", "")
        metadata_audio = metadata.get("audio") if isinstance(metadata.get("audio"), dict) else {}
        if metadata_audio.get("identification_method") == "instagram_metadata":
            synthesis["audio"] = {
                "title": metadata_audio.get("title"),
                "artist": metadata_audio.get("artist"),
                "source_url": metadata_audio.get("source_url"),
                "identification_method": "instagram_metadata",
                "confidence": metadata_audio.get("confidence") or "high",
            }
        elif not isinstance(synthesis.get("audio"), dict):
            synthesis["audio"] = {
                "title": None,
                "artist": None,
                "source_url": None,
                "identification_method": "unidentified",
                "confidence": "unverified",
            }
        synthesis["comments"] = metadata.get("comments") or []
        synthesis["reported_comment_count"] = metadata.get("comment_count")
        synthesis_path = workdir / "synthesis.json"
        synthesis_path.write_text(json.dumps(synthesis, ensure_ascii=False, indent=2), encoding="utf-8")
        upload_artifact(callback_base, callback_token, job_id, "synthesis", synthesis_path)

        response = requests.post(
            callback_url(callback_base, job_id, "complete"),
            headers={"Authorization": f"Bearer {callback_token}", "Content-Type": "application/json"},
            data=synthesis_path.read_bytes(),
            timeout=180,
        )
        response.raise_for_status()
        completed = response.json()
        return {
            "ok": True,
            "job_id": job_id,
            "shortcode": metadata["id"],
            "frames": len(analysis_frames),
            "carousel_items": len(carousel_items) or int(metadata.get("carousel_item_count") or 0),
            "resources": completed.get("resource_count", len(synthesis.get("resources") or [])),
            "resumed_research": resume_only,
            "auth_json": refreshed_auth,
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def local_smoke(source_url: str, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    video, metadata, carousel_items, carousel_manifest, carousel_frames = download_instagram_media(source_url, output_dir)
    probe, audio, frames = inspect_and_extract(video, output_dir)
    (output_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "comments.json").write_text(json.dumps(metadata.get("comments") or [], ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "media-probe.json").write_text(json.dumps(probe, indent=2), encoding="utf-8")
    summary = {
        "ok": True,
        "video": str(video),
        "video_bytes": video.stat().st_size,
        "metadata": metadata,
        "probe": probe,
        "audio": str(audio) if audio else None,
        "frames": [str(frame) for frame in frames],
        "analysis_frames": [str(frame) for frame in (carousel_frames[:MAX_FRAMES] if carousel_frames else frames)],
        "carousel_items": [str(item) for item in carousel_items],
        "carousel_manifest": str(carousel_manifest) if carousel_manifest else None,
    }
    print(json.dumps(summary, ensure_ascii=True, indent=2))


def local_synthesize(output_dir: Path) -> None:
    metadata_path = output_dir / "metadata.json"
    if metadata_path.exists():
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    else:
        info_files = sorted(output_dir.glob("reel.info.json"))
        if not info_files:
            raise RuntimeError("The synthesis directory has no metadata.json or reel.info.json")
        raw = json.loads(info_files[0].read_text(encoding="utf-8"))
        metadata = safe_metadata(raw, str(raw.get("webpage_url") or ""))
    transcript_path = output_dir / "transcript.json"
    if transcript_path.exists():
        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    else:
        transcript = {"ok": True, "text": "", "segments": [], "note": "Local synthesis smoke did not call Workers AI transcription."}
        transcript_path.write_text(json.dumps(transcript, indent=2), encoding="utf-8")
    (output_dir / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    frames = sorted((output_dir / "frames").glob("*.jpg"))[:MAX_FRAMES]
    synthesis, _ = run_codex(
        output_dir,
        build_prompt(metadata, transcript, "Test the default research profile."),
        frames,
        600,
        os.environ.get("CODEX_AUTH_JSON", ""),
    )
    result_path = output_dir / "synthesis.json"
    result_path.write_text(json.dumps(synthesis, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "result": str(result_path),
        "summary": synthesis.get("summary"),
        "resource_names": [resource.get("name") for resource in synthesis.get("resources") or []],
        "claim_count": len(synthesis.get("claims") or []),
        "codex_usage": synthesis.get("codex_usage"),
    }, ensure_ascii=True, indent=2))


class Handler(BaseHTTPRequestHandler):
    server_version = "ReelBrain/0.1"

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self.send_json(200, {"ok": True, "service": "instagram-reel-brain-container", "ffmpeg": bool(shutil.which("ffmpeg")), "yt_dlp": bool(shutil.which("yt-dlp")), "codex": bool(shutil.which("codex"))})
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/codex-auth-probe":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
                self.send_json(200, probe_codex_auth(payload))
            except PipelineError as exc:
                self.send_json(500, {"ok": False, "authenticated": False, "available": False, "detail": str(exc), "auth_json": exc.auth_json})
            return
        if self.path != "/process":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            self.send_json(200, process(payload))
        except PipelineError as exc:
            traceback.print_exc()
            self.send_json(500, {"ok": False, "error_code": exc.code, "error": str(exc), "auth_json": exc.auth_json})
        except Exception as exc:
            traceback.print_exc()
            self.send_json(500, {"ok": False, "error_code": "error_unknown", "error": str(exc)})

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) >= 4 and sys.argv[1] == "--local-smoke":
        local_smoke(sys.argv[2], Path(sys.argv[3]).resolve())
    elif len(sys.argv) >= 3 and sys.argv[1] == "--local-synthesize":
        local_synthesize(Path(sys.argv[2]).resolve())
    else:
        ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
