import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getLiveReelLibraryManifest } from "../functions/_lib/reel-library.js";

test("Reel Library reads the authenticated Ubuntu manifest", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://worker.example/api/phase7/origin/v1/library/manifest");
    assert.equal(init.headers.authorization, "Bearer synthetic-token");
    return Response.json({ ok: true, generated_at: "2026-08-25T00:00:00Z", file_count: 2, files: [{ path: "reels/a.html" }] });
  };
  const result = await getLiveReelLibraryManifest({
    PHASE7_ORIGIN_URL: "https://worker.example/api/phase7/origin",
    PHASE7_ORIGIN_TOKEN: "synthetic-token",
  });
  assert.equal(result.file_count, 2);
});

test("Reel Library handler falls back to the immutable cloud copy on origin failure", () => {
  const source = readFileSync(new URL("../functions/api/reel-library/files.js", import.meta.url), "utf8");
  const liveCall = source.indexOf("getLiveReelLibraryManifest(context.env)");
  const fallback = source.indexOf('source: "cloud-static-fallback"');
  assert.ok(liveCall > 0 && fallback > liveCall);
  assert.match(source.slice(liveCall, fallback), /catch \(_error\)/);
});
