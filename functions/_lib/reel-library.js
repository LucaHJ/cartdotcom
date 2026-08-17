import { normalizeString } from "./backend-auth.js";

const FILE_PREFIX = "reel-library:file:";
const MANIFEST_KEY = "reel-library:manifest";

function toBase64Url(value) {
    const bytes = new TextEncoder().encode(String(value || ""));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function getReelLibraryKV(env) {
    return env.REEL_LIBRARY_KV || env.SECOND_BRAIN_KV || null;
}

export function normalizeLibraryPath(value) {
    const path = normalizeString(value, 400).replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path || !path.endsWith(".html")) throw new Error("A valid HTML file path is required.");
    if (path === ".." || path.includes("../") || path.includes("/..")) throw new Error("Path traversal is not allowed.");
    return path.split("/").filter(Boolean).join("/");
}

export async function getReelLibraryManifest(kv) {
    const manifest = await kv.get(MANIFEST_KEY, "json");
    if (!manifest || !Array.isArray(manifest.files)) return { generated_at: "", file_count: 0, files: [] };
    return manifest;
}

export async function getReelLibraryFile(kv, pathValue) {
    const path = normalizeLibraryPath(pathValue);
    const result = await kv.getWithMetadata(`${FILE_PREFIX}${toBase64Url(path)}`, "text");
    if (result.value === null) return null;
    return { path, html: result.value, metadata: result.metadata || {} };
}
