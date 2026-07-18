from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
import threading
import traceback
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
RESEARCH_SEMAPHORE = threading.Semaphore(1)


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


def exception_text(exc: BaseException) -> str:
    messages: list[str] = []

    def collect(error: BaseException) -> None:
        nested = getattr(error, "exceptions", None)
        if nested:
            for child in nested:
                collect(child)
            return
        message = str(error).strip()
        if message and message not in messages:
            messages.append(message)

    collect(exc)
    summary = "; ".join(messages) or str(exc) or type(exc).__name__
    trace = "".join(traceback.format_exception(exc)).strip()
    return f"{summary}; traceback: {trace[-3000:]}" if trace else summary


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


def run_research_exec(prompt: str, timeout_seconds: int) -> str:
    output_file = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", delete=False)
    output_path = Path(output_file.name)
    output_file.close()
    command = [
        codex_command(),
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--ignore-user-config",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--output-last-message",
        str(output_path),
    ]
    model = os.getenv("CODEX_RESEARCH_MODEL", "").strip()
    if model:
        command.extend(["--model", model])
    command.append("-")

    try:
        completed = subprocess.run(
            command,
            input=prompt,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=timeout_seconds,
            cwd="/workspace",
        )
        memo = output_path.read_text(encoding="utf-8").strip() if output_path.exists() else ""
        if completed.returncode != 0 or not memo:
            detail = (completed.stderr or completed.stdout or "Codex exec returned no output").strip()
            raise RuntimeError(detail[-4000:])
        return memo
    finally:
        output_path.unlink(missing_ok=True)


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
        with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as errlog:
            try:
                async with stdio_client(params, errlog=errlog) as (read, write):
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
            except Exception as exc:
                errlog.seek(0)
                stderr = errlog.read().strip()
                mcp_error = exception_text(exc)
                if stderr:
                    mcp_error = f"{mcp_error}; codex stderr: {stderr[-4000:]}"
                try:
                    return await asyncio.to_thread(run_research_exec, prompt, timeout_seconds)
                except Exception as exec_exc:
                    raise RuntimeError(f"MCP failed: {mcp_error}; CLI fallback failed: {exception_text(exec_exc)}") from exec_exc
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
                    with RESEARCH_SEMAPHORE:
                        memo = asyncio.run(run_research(prompt, timeout_seconds=timeout_seconds))
                    response = {"ok": True, "memo": memo}
                    if include_auth:
                        response["auth_json"] = current_auth_json()
                    self.send_json(response)
                except Exception as exc:
                    response = {"ok": False, "error": exception_text(exc)}
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
