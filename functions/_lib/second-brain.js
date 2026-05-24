import { json, normalizeString } from "./mobile-auth.js";

const KEY_PREFIX = "second-brain:file:";
const MANIFEST_KEY = "second-brain:manifest";
const MAX_PAGE_BYTES = 256 * 1024;

export function getSecondBrainKV(env) {
    return env.SECOND_BRAIN_KV || null;
}

export function normalizeVaultPath(value) {
    let path = normalizeString(value, 260).replace(/\\/g, "/").replace(/^\/+/, "");
    if (path.toLowerCase().startsWith("vault/")) path = path.slice(6);
    path = path.split("/").filter(Boolean).join("/");

    if (!path) throw new Error("Path is required.");
    if (path.includes("../") || path.includes("/..") || path === "..") throw new Error("Path cannot traverse directories.");
    if (!/\.md$/i.test(path)) throw new Error("Only Markdown files can be edited in this phase.");

    return path;
}

function bytesFor(value) {
    return new TextEncoder().encode(String(value || ""));
}

export function toBase64Url(value) {
    let binary = "";
    for (const byte of bytesFor(value)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value) {
    const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
}

export function keyForPath(path) {
    return `${KEY_PREFIX}${toBase64Url(normalizeVaultPath(path))}`;
}

async function sha256Hex(value) {
    const digest = await crypto.subtle.digest("SHA-256", bytesFor(value));
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function metadataFor(path, content, actorEmail) {
    const bytes = bytesFor(content).byteLength;
    if (bytes > MAX_PAGE_BYTES) {
        throw new Error(`Markdown page is too large for browser editing. Limit is ${MAX_PAGE_BYTES} bytes.`);
    }

    return {
        path,
        bytes,
        sha256: await sha256Hex(content),
        updated_at: new Date().toISOString(),
        updated_by: actorEmail || "cloudflare-access-user",
        source: "cartdotcom-second-brain",
        content_type: "text/markdown; charset=utf-8"
    };
}

export async function listPages(kv) {
    const pages = [];
    let cursor;
    do {
        const result = await kv.list({ prefix: KEY_PREFIX, cursor });
        for (const key of result.keys || []) {
            const metadata = key.metadata || {};
            let path = metadata.path;
            if (!path && key.name.startsWith(KEY_PREFIX)) {
                try {
                    path = fromBase64Url(key.name.slice(KEY_PREFIX.length));
                } catch (error) {
                    path = key.name;
                }
            }
            pages.push({
                key: key.name,
                path,
                bytes: metadata.bytes || null,
                sha256: metadata.sha256 || "",
                updated_at: metadata.updated_at || "",
                updated_by: metadata.updated_by || ""
            });
        }
        cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    pages.sort((a, b) => String(a.path).localeCompare(String(b.path)));
    return pages;
}

export async function getPage(kv, pathValue) {
    const path = normalizeVaultPath(pathValue);
    const result = await kv.getWithMetadata(keyForPath(path), "text");
    if (result.value === null) return null;
    return {
        path,
        content: result.value,
        metadata: result.metadata || {}
    };
}

export async function putPage(kv, pathValue, content, actorEmail) {
    const path = normalizeVaultPath(pathValue);
    const text = String(content || "");
    const metadata = await metadataFor(path, text, actorEmail);
    await kv.put(keyForPath(path), text, { metadata });
    return { path, metadata };
}

export async function putManifest(kv, pages) {
    const manifest = {
        generated_at: new Date().toISOString(),
        file_count: pages.length,
        pages: pages.map(page => ({
            path: page.path,
            bytes: page.bytes || null,
            sha256: page.sha256 || "",
            updated_at: page.updated_at || ""
        }))
    };
    await kv.put(MANIFEST_KEY, JSON.stringify(manifest), {
        metadata: {
            generated_at: manifest.generated_at,
            file_count: manifest.file_count
        }
    });
    return manifest;
}

export function missingSecondBrainKV() {
    return json({ error: "SECOND_BRAIN_KV binding is required." }, 503);
}
