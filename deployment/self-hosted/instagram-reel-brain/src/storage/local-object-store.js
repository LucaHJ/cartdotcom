import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";

export class ObjectStorePathError extends Error {
  constructor(message) {
    super(message);
    this.name = "ObjectStorePathError";
    this.code = "object_store_path";
  }
}

export class LocalObjectStore {
  constructor(root) {
    if (!root) throw new TypeError("LocalObjectStore requires a root path");
    this.root = resolve(root);
  }

  resolveKey(key) {
    const clean = normalize(String(key || "").replace(/^[/\\]+/, ""));
    if (!clean || clean.includes("..")) throw new ObjectStorePathError("Object key must be relative and non-empty");
    const target = resolve(join(this.root, clean));
    const rel = relative(this.root, target);
    if (rel.startsWith("..") || resolve(target) === this.root) throw new ObjectStorePathError("Object key escapes storage root");
    return target;
  }

  async put(key, data, { contentType = "application/octet-stream" } = {}) {
    const target = this.resolveKey(key);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return {
      key,
      contentType,
      byteLength: buffer.byteLength,
      checksum: createHash("sha256").update(buffer).digest("hex"),
    };
  }

  async get(key) {
    return readFile(this.resolveKey(key));
  }

  async head(key) {
    const target = this.resolveKey(key);
    const info = await stat(target);
    const hash = createHash("sha256");
    await new Promise((resolvePromise, reject) => {
      createReadStream(target)
        .on("data", (chunk) => hash.update(chunk))
        .on("error", reject)
        .on("end", resolvePromise);
    });
    return { key, byteLength: info.size, checksum: hash.digest("hex"), updatedAt: info.mtime.toISOString() };
  }
}
