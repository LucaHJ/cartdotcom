import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const exportPath = resolve(process.argv[2] || "");
const uploadUrl = process.env.OFFSITE_UPLOAD_URL
  || "https://cartdotcom-news-signal-container.lucajeannin.workers.dev/api/internal/offsite-object";
const token = String(process.env.OFFSITE_BACKUP_TOKEN || "").trim();
const timestamp = process.env.D1_BACKUP_TIMESTAMP
  || new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const chunkBytes = 32 * 1024 * 1024;

if (!process.argv[2]) throw new Error("Usage: node upload-d1-export.mjs /path/to/export.sql");
if (!token) throw new Error("OFFSITE_BACKUP_TOKEN is required");
if (!/^\d{8}T\d{6}Z$/.test(timestamp)) throw new Error("D1_BACKUP_TIMESTAMP must use YYYYMMDDTHHMMSSZ");

async function uploadObject(objectKey, body, digest, contentType) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": contentType,
          "x-content-sha256": digest,
          "x-object-key": objectKey,
        },
        body,
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 2000));
    }
  }
  throw new Error(`Unable to upload ${objectKey}: ${lastError}`);
}

const file = await open(exportPath, "r");
const exportHash = createHash("sha256");
const chunks = [];
let offset = 0;
try {
  for (let index = 0; ; index += 1) {
    const buffer = Buffer.allocUnsafe(chunkBytes);
    const { bytesRead } = await file.read(buffer, 0, chunkBytes, offset);
    if (!bytesRead) break;
    const body = buffer.subarray(0, bytesRead);
    const name = `part-${String(index).padStart(4, "0")}`;
    const digest = createHash("sha256").update(body).digest("hex");
    exportHash.update(body);
    await uploadObject(`_backups/d1/${timestamp}/${name}`, body, digest, "application/octet-stream");
    chunks.push({ name, bytes: bytesRead, sha256: digest });
    offset += bytesRead;
    console.log(`Uploaded ${name} (${bytesRead} bytes)`);
  }
} finally {
  await file.close();
}

if (!chunks.length) throw new Error("D1 export is empty");
const manifest = {
  version: 1,
  backup_kind: "d1",
  created_at: new Date().toISOString(),
  export_name: basename(exportPath),
  export_bytes: offset,
  export_sha256: exportHash.digest("hex"),
  chunk_count: chunks.length,
  chunk_bytes: chunkBytes,
  chunks,
};
const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const manifestHash = createHash("sha256").update(manifestBody).digest("hex");
await uploadObject(
  `_backups/d1/${timestamp}/manifest.json`,
  manifestBody,
  manifestHash,
  "application/json",
);

console.log(`D1_BACKUP_TIMESTAMP=${timestamp}`);
console.log(`D1 export uploaded and verified: ${offset} bytes in ${chunks.length} chunks.`);
