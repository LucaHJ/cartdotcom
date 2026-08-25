import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/phase7_origin.py", import.meta.url));
const dispatcherWatchdog = readFileSync(new URL("../scripts/phase6_dispatcher_watchdog.sh", import.meta.url), "utf8");
const safetyPoll = readFileSync(new URL("../scripts/phase7_safety_poll.sh", import.meta.url), "utf8");

function freePort() {
  const probe = spawnSync("python", ["-c", "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()"], { encoding: "utf8" });
  assert.equal(probe.status, 0);
  return Number(probe.stdout.trim());
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("origin did not start");
}

test("phase7 origin authenticates and atomically verifies local library/object writes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "phase7-origin-"));
  const token = randomBytes(40).toString("hex");
  const tokenFile = join(root, "token");
  writeFileSync(tokenFile, token);
  chmodSync(tokenFile, 0o600);
  const port = freePort();
  const child = spawn("python", [script, "--bind", "127.0.0.1", "--port", String(port), "--token-file", tokenFile,
    "--run-dir", join(root, "run"), "--object-root", join(root, "objects"), "--library-root", join(root, "library")],
  { stdio: "ignore" });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/healthz`);

  const denied = await fetch(`${base}/v1/library/manifest`);
  assert.equal(denied.status, 401);
  const html = Buffer.from("<h1>Phase 7</h1>");
  const sha = createHash("sha256").update(html).digest("hex");
  const written = await fetch(`${base}/v1/library/file/reels/test/index.html`, {
    method: "PUT", headers: { authorization: `Bearer ${token}`, "x-content-sha256": sha, "content-length": String(html.length) }, body: html,
  });
  assert.equal(written.status, 200);
  assert.equal(readFileSync(join(root, "library", "reels", "test", "index.html"), "utf8"), html.toString());

  const file = await fetch(`${base}/v1/library/file/reels/test/index.html`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(file.headers.get("x-phase7-source"), "ubuntu");
  assert.equal(await file.text(), html.toString());
  const manifest = await fetch(`${base}/v1/library/manifest`, { headers: { authorization: `Bearer ${token}` } }).then((response) => response.json());
  assert.equal(manifest.file_count, 1);

  const conflict = await fetch(`${base}/v1/library/file/reels/test/index.html`, {
    method: "PUT", headers: { authorization: `Bearer ${token}`, "x-content-sha256": createHash("sha256").update("different").digest("hex"), "content-length": "9" }, body: "different",
  });
  assert.equal(conflict.status, 409);
  assert.equal(readFileSync(join(root, "library", "reels", "test", "index.html"), "utf8"), html.toString());
  assert.equal((await fetch(`${base}/v1/library/file/reels/%5C../escape.html`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-length": "1" }, body: "x" })).status, 400);
  assert.equal((await fetch(`${base}/v1/library/file/reels/test/index.html`, { method: "DELETE" })).status, 405);
});

test("phase7 dispatcher has event wake plus bounded safety poll", () => {
  const source = readFileSync(new URL("../scripts/phase6_dispatcher.py", import.meta.url), "utf8");
  assert.match(source, /signal\.SIGUSR1/);
  assert.match(source, /wake_event\.wait\(max\(5, args\.poll_seconds\)\)/);
  assert.doesNotMatch(source, /time\.sleep\(max\(5, args\.poll_seconds\)\)/);
  assert.match(dispatcherWatchdog, /SCHEMA=reel_phase7_primary_20260825_133007/);
  assert.match(dispatcherWatchdog, /POLL_SECONDS=300/);
  assert.match(dispatcherWatchdog, /9>&-/);
  assert.match(safetyPoll, /tr -d '\\r\\n'/);
  assert.match(safetyPoll, /flock -n/);
});
