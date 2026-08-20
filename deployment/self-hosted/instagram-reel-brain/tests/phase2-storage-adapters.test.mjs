import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { disabledAdapterSet, DisabledAdapterError } from "../src/adapters/disabled-adapters.js";
import { LocalObjectStore, ObjectStorePathError } from "../src/storage/local-object-store.js";

test("Local object store writes fixture artifacts under the configured root with checksums", async () => {
  const root = await mkdtemp(join(tmpdir(), "reel-object-store-"));
  const store = new LocalObjectStore(root);

  const result = await store.put("job-1/video/original.mp4", Buffer.from("fixture"), { contentType: "video/mp4" });
  assert.equal(result.byteLength, 7);
  assert.equal(result.contentType, "video/mp4");
  assert.equal(result.checksum.length, 64);
  assert.equal((await store.head("job-1/video/original.mp4")).checksum, result.checksum);
  assert.equal(String(await readFile(join(root, "job-1/video/original.mp4"))), "fixture");
});

test("Local object store prevents path traversal and root overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "reel-object-store-"));
  const store = new LocalObjectStore(root);

  await assert.rejects(() => store.put("../escape.txt", "bad"), ObjectStorePathError);
  await assert.rejects(() => store.put("", "bad"), ObjectStorePathError);
});

test("Local object store rejects symlink escapes on supported platforms", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "reel-object-store-"));
  const outside = await mkdtemp(join(tmpdir(), "reel-object-outside-"));
  await writeFile(join(outside, "secret.txt"), "outside");
  try {
    await symlink(join(outside, "secret.txt"), join(root, "linked.txt"));
  } catch (error) {
    if (["EPERM", "EACCES", "EINVAL"].includes(error?.code)) {
      context.skip(`symlink creation unavailable on this platform: ${error.code}`);
      return;
    }
    throw error;
  }
  const store = new LocalObjectStore(root);

  await assert.rejects(() => store.get("linked.txt"), ObjectStorePathError);
  await assert.rejects(() => store.put("linked.txt", "overwrite"), ObjectStorePathError);
});

test("Phase 2 Cloudflare and Instagram adapters are disabled and fail closed", async () => {
  const adapters = disabledAdapterSet();
  for (const adapter of Object.values(adapters)) {
    assert.equal(adapter.enabled, false);
    await assert.rejects(() => adapter.send({}), DisabledAdapterError);
  }
});
