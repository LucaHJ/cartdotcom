import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
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

  async assertRealPathInside(path, { allowRoot = false } = {}) {
    const rootReal = await realpath(this.root);
    const pathReal = await realpath(path);
    const rel = relative(rootReal, pathReal);
    if (rel.startsWith("..") || (rel === "" && !allowRoot)) throw new ObjectStorePathError("Object path escapes storage root");
    return pathReal;
  }

  async assertParentInside(target) {
    await mkdir(dirname(target), { recursive: true });
    await this.assertRealPathInside(dirname(target), { allowRoot: true });
  }

  async assertTargetIsNotSymlink(target) {
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new ObjectStorePathError("Object target must not be a symlink");
    } catch (error) {
      if (error instanceof ObjectStorePathError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async put(key, data, { contentType = "application/octet-stream" } = {}) {
    const target = this.resolveKey(key);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await this.assertParentInside(target);
    await this.assertTargetIsNotSymlink(target);
    await writeFile(target, buffer);
    await this.assertRealPathInside(target);
    return {
      key,
      contentType,
      byteLength: buffer.byteLength,
      checksum: createHash("sha256").update(buffer).digest("hex"),
    };
  }

  async get(key) {
    const target = this.resolveKey(key);
    await this.assertTargetIsNotSymlink(target);
    await this.assertRealPathInside(target);
    return readFile(target);
  }

  async head(key) {
    const target = this.resolveKey(key);
    await this.assertTargetIsNotSymlink(target);
    await this.assertRealPathInside(target);
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
