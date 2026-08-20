import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const workerSource = readFileSync(new URL("tools/r2-inventory-worker/src/index.js", root), "utf8");
const workerConfig = readFileSync(new URL("tools/r2-inventory-worker/wrangler.jsonc", root), "utf8");
const parsedConfig = JSON.parse(workerConfig);

test("Phase 3 R2 inventory worker is GET-only and list-only", () => {
  assert.match(workerSource, /request\.method !== "GET"/);
  assert.match(workerSource, /url\.pathname !== "\/inventory\/r2\/list"/);
  assert.match(workerSource, /REEL_ARCHIVE\.list\(\{ limit, cursor \}\)/);

  for (const prohibited of [
    "REEL_ARCHIVE.put(",
    "REEL_ARCHIVE.delete(",
    "REEL_ARCHIVE.createMultipartUpload(",
    "REEL_ARCHIVE.resumeMultipartUpload(",
    "REEL_ARCHIVE.get(",
    "REEL_ARCHIVE.head(",
  ]) {
    assert.equal(workerSource.includes(prohibited), false, `${prohibited} must be absent`);
  }
});

test("Phase 3 R2 inventory worker binds only the existing remote archive bucket", () => {
  assert.deepEqual(parsedConfig.r2_buckets, [{
    binding: "REEL_ARCHIVE",
    bucket_name: "cartdotcom-instagram-reel-brain",
    remote: true,
  }]);

  for (const prohibited of [
    "d1_databases",
    "kv_namespaces",
    "queues",
    "ai",
    "browser",
    "durable_objects",
    "containers",
    "routes",
    "triggers",
  ]) {
    assert.equal(Object.hasOwn(parsedConfig, prohibited), false, `${prohibited} binding/config must be absent`);
  }
});
