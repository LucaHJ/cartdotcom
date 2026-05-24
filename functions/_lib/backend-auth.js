const COOKIE_NAME = "cartdotcom_backend";
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

export function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            ...extraHeaders
        }
    });
}

export function normalizeString(value, maxLength = 4000) {
    return String(value || "").trim().slice(0, maxLength);
}

function base64UrlEncode(value) {
    const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value || ""));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
    const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
}

async function sha256Hex(value) {
    const data = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, value) {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
    return Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
    const left = String(a || "");
    const right = String(b || "");
    if (left.length !== right.length) return false;
    let result = 0;
    for (let index = 0; index < left.length; index += 1) {
        result |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return result === 0;
}

function parseCookies(request) {
    const cookies = {};
    const header = request.headers.get("cookie") || "";
    for (const part of header.split(";")) {
        const index = part.indexOf("=");
        if (index === -1) continue;
        const name = part.slice(0, index).trim();
        const value = part.slice(index + 1).trim();
        cookies[name] = value;
    }
    return cookies;
}

function configuredUsername(env) {
    return normalizeString(env.BACKEND_USERNAME || env.BACKEND_AUTH_USERNAME, 160);
}

async function configuredPasswordHash(env) {
    const hash = normalizeString(env.BACKEND_PASSWORD_SHA256 || env.BACKEND_PASSWORD_HASH, 128).toLowerCase();
    if (hash) return hash;

    const password = normalizeString(env.BACKEND_PASSWORD || env.BACKEND_AUTH_PASSWORD, 4000);
    if (!password) return "";
    return sha256Hex(password);
}

function configuredActorEmail(env, username) {
    const explicit = normalizeString(env.BACKEND_ACTOR_EMAIL || env.MOBILE_APPROVAL_OWNER_EMAIL, 320).toLowerCase();
    if (explicit) return explicit;

    const firstAllowed = normalizeString(env.ALLOWED_ACCESS_EMAILS, 4000)
        .split(",")
        .map(item => item.trim().toLowerCase())
        .filter(Boolean)[0];
    if (firstAllowed) return firstAllowed;

    return username.includes("@") ? username.toLowerCase() : "backend-user@cartdotcom.local";
}

function configuredSessionSecret(env, fallback) {
    return normalizeString(env.BACKEND_SESSION_SECRET, 4000) || fallback;
}

export async function getBackendAuthConfig(env) {
    const username = configuredUsername(env);
    const passwordHash = await configuredPasswordHash(env);
    const sessionSecret = configuredSessionSecret(env, passwordHash);
    const ttlSeconds = Math.max(300, Number(env.BACKEND_SESSION_TTL_SECONDS) || DEFAULT_TTL_SECONDS);

    return {
        configured: Boolean(username && passwordHash && sessionSecret),
        username,
        passwordHash,
        sessionSecret,
        actorEmail: configuredActorEmail(env, username),
        ttlSeconds
    };
}

export async function verifyBackendLogin(env, username, password) {
    const config = await getBackendAuthConfig(env);
    if (!config.configured) {
        return { ok: false, error: "Backend login is not configured. Set BACKEND_USERNAME, BACKEND_PASSWORD_SHA256, BACKEND_SESSION_SECRET, and BACKEND_ACTOR_EMAIL in Cloudflare Pages." };
    }

    const inputUsername = normalizeString(username, 160);
    const inputHash = await sha256Hex(String(password || ""));
    const usernameOk = timingSafeEqual(inputUsername, config.username);
    const passwordOk = timingSafeEqual(inputHash, config.passwordHash);
    if (!usernameOk || !passwordOk) return { ok: false, error: "Invalid username or password." };

    return {
        ok: true,
        username: config.username,
        email: config.actorEmail,
        ttlSeconds: config.ttlSeconds
    };
}

export async function createBackendSessionCookie(env, actor) {
    const config = await getBackendAuthConfig(env);
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: actor.username,
        email: actor.email,
        iat: now,
        exp: now + config.ttlSeconds,
        nonce: crypto.randomUUID()
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = await hmacHex(config.sessionSecret, encodedPayload);
    return `${COOKIE_NAME}=${encodedPayload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${config.ttlSeconds}`;
}

export function clearBackendSessionCookie() {
    return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function getBackendSession(request, env) {
    const config = await getBackendAuthConfig(env);
    if (!config.configured) {
        return { ok: false, error: "Backend login is not configured." };
    }

    const token = parseCookies(request)[COOKIE_NAME];
    if (!token || !token.includes(".")) return { ok: false, error: "Backend login is required." };

    const [encodedPayload, signature] = token.split(".");
    const expectedSignature = await hmacHex(config.sessionSecret, encodedPayload);
    if (!timingSafeEqual(signature, expectedSignature)) {
        return { ok: false, error: "Backend session is invalid." };
    }

    let payload;
    try {
        payload = JSON.parse(base64UrlDecode(encodedPayload));
    } catch (error) {
        return { ok: false, error: "Backend session is invalid." };
    }

    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
        return { ok: false, error: "Backend session expired." };
    }

    return {
        ok: true,
        username: normalizeString(payload.sub, 160),
        email: normalizeString(payload.email, 320).toLowerCase() || config.actorEmail
    };
}

export async function requireBackendSession(context) {
    const session = await getBackendSession(context.request, context.env);
    if (!session.ok) return session;

    const allowed = normalizeString(context.env.BACKEND_ALLOWED_EMAILS, 4000)
        .split(",")
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);
    if (allowed.length && !allowed.includes(session.email)) {
        return { ok: false, error: "This backend session is not allowed." };
    }

    return session;
}

export function backendLoginRedirect(request) {
    const url = new URL(request.url);
    const next = `${url.pathname}${url.search}`;
    return Response.redirect(`${url.origin}/login.html?next=${encodeURIComponent(next)}`, 302);
}
