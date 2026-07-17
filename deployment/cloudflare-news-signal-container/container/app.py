from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import threading
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


HOST = "0.0.0.0"
PORT = int(os.getenv("PORT", "8080"))
CODEX_HOME = Path(os.getenv("CODEX_HOME", "/home/codex/.codex"))
AUTH_LOCK = threading.Lock()
AUTH_READY = False


def codex_command() -> str:
    return os.getenv("CODEX_MCP_COMMAND") or shutil.which("codex") or "codex"


def response_text(result: Any) -> str:
    structured = getattr(result, "structuredContent", None) or getattr(result, "structured_content", None)
    if isinstance(structured, dict) and structured.get("content"):
        return str(structured["content"])

    chunks: list[str] = []
    for item in getattr(result, "content", []) or []:
        text = getattr(item, "text", None)
        if text:
            chunks.append(str(text))
    return "\n".join(chunks).strip() if chunks else str(result)


def current_auth_json() -> str | None:
    auth_file = CODEX_HOME / "auth.json"
    if not auth_file.exists():
        return None
    value = auth_file.read_text(encoding="utf-8").strip()
    return value or None


def run_login(flag: str, secret: str) -> None:
    completed = subprocess.run(
        [codex_command(), "login", flag],
        input=secret,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=60,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"codex login {flag} failed: {completed.stderr[-800:]}")


def ensure_codex_auth() -> str:
    global AUTH_READY
    with AUTH_LOCK:
        if AUTH_READY:
            return "cached"

        CODEX_HOME.mkdir(parents=True, exist_ok=True)
        auth_file = CODEX_HOME / "auth.json"
        if auth_file.exists():
            AUTH_READY = True
            return "auth_file"

        auth_json = os.getenv("CODEX_AUTH_JSON", "").strip()
        if auth_json:
            parsed = json.loads(auth_json)
            auth_file.write_text(json.dumps(parsed), encoding="utf-8")
            os.chmod(auth_file, 0o600)
            AUTH_READY = True
            return "auth_json_secret"

        access_token = os.getenv("CODEX_ACCESS_TOKEN", "").strip()
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if access_token:
            run_login("--with-access-token", access_token)
            AUTH_READY = True
            return "access_token"
        if api_key:
            run_login("--with-api-key", api_key)
            AUTH_READY = True
            return "api_key"
        raise RuntimeError(
            "No Codex auth available. Set CODEX_AUTH_JSON, CODEX_ACCESS_TOKEN, or OPENAI_API_KEY as a Worker secret."
        )


async def list_tools(timeout_seconds: int = 60) -> list[str]:
    ensure_codex_auth()
    params = StdioServerParameters(command=codex_command(), args=["mcp-server"])
    previous_disable_level = logging.root.manager.disable
    logging.disable(logging.WARNING)
    try:
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=timeout_seconds)) as session:
                await session.initialize()
                tools = await session.list_tools()
                return [tool.name for tool in tools.tools]
    finally:
        logging.disable(previous_disable_level)


async def run_research(prompt: str, timeout_seconds: int = 3600) -> str:
    ensure_codex_auth()
    args: dict[str, Any] = {
        "prompt": prompt,
        "approval-policy": "never",
        "sandbox": "read-only",
        "cwd": "/workspace",
    }
    model = os.getenv("CODEX_RESEARCH_MODEL", "").strip()
    if model:
        args["model"] = model

    params = StdioServerParameters(command=codex_command(), args=["mcp-server"])
    previous_disable_level = logging.root.manager.disable
    logging.disable(logging.WARNING)
    try:
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=timeout_seconds)) as session:
                await session.initialize()
                result = await session.call_tool(
                    "codex",
                    arguments=args,
                    read_timeout_seconds=timedelta(seconds=timeout_seconds),
                )
                text = response_text(result)
                if getattr(result, "isError", False) or getattr(result, "is_error", False):
                    raise RuntimeError(text or "Codex research tool failed")
                return text
    finally:
        logging.disable(previous_disable_level)


class Handler(BaseHTTPRequestHandler):
    server_version = "cartdotcom-news-signal-container/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        try:
            if self.path.startswith("/health"):
                self.send_json(
                    {
                        "ok": True,
                        "codex_command": codex_command(),
                        "codex_home": str(CODEX_HOME),
                        "has_auth_file": (CODEX_HOME / "auth.json").exists(),
                        "has_codex_auth_json": bool(os.getenv("CODEX_AUTH_JSON")),
                        "has_openai_api_key": bool(os.getenv("OPENAI_API_KEY")),
                        "has_codex_access_token": bool(os.getenv("CODEX_ACCESS_TOKEN")),
                    }
                )
                return

            if self.path.startswith("/mcp-check"):
                tools = asyncio.run(list_tools())
                self.send_json({"ok": True, "tools": tools})
                return

            self.send_json({"error": "Not found"}, status=404)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=500)

    def do_POST(self) -> None:
        try:
            request_path = self.path.split("?", 1)[0]
            if request_path in {"/research", "/research-internal"}:
                payload = self.read_json()
                prompt = str(payload.get("prompt") or "").strip()
                if not prompt:
                    self.send_json({"ok": False, "error": "Missing prompt"}, status=400)
                    return
                timeout_seconds = int(payload.get("timeout_seconds") or 3600)
                include_auth = request_path == "/research-internal"
                try:
                    memo = asyncio.run(run_research(prompt, timeout_seconds=timeout_seconds))
                    response = {"ok": True, "memo": memo}
                    if include_auth:
                        response["auth_json"] = current_auth_json()
                    self.send_json(response)
                except Exception as exc:
                    response = {"ok": False, "error": str(exc)}
                    if include_auth:
                        response["auth_json"] = current_auth_json()
                    self.send_json(response, status=500)
                return

            if self.path.startswith("/login-check"):
                method = ensure_codex_auth()
                self.send_json({"ok": True, "auth_method": method})
                return

            self.send_json({"error": "Not found"}, status=404)
        except Exception as exc:
            self.send_json({"ok": False, "error": str(exc)}, status=500)


def main() -> None:
    print(f"Starting container HTTP server on {HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
